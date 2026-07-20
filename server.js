const express = require('express')
const sqlite3 = require('sqlite3').verbose()
const cors = require('cors')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const path = require('path')
require("dotenv").config();
const Razorpay = require("razorpay");
const cookieParser = require("cookie-parser")
const auth = require("./middleware/auth")

const app = express()
app.use(cors({
    origin: (origin, callback) => {
        const allowedOrigins = [
            "http://localhost:5173",
            "http://localhost:5174",
            "http://127.0.0.1:5173",
            "http://127.0.0.1:5174",
            "https://travel-dashboard-sklj.vercel.app",
        ];

        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error(`Origin ${origin} not allowed by CORS`));
        }
    },
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());


const db = new sqlite3.Database(path.join(__dirname, 'travel.db'));

const SECRET = "travel_secret_key"

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
})

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users(
            id integer primary key autoincrement,
            name TEXT,
            email TEXT UNIQUE,
            password TEXT
        )
    `, (err) => {
        if (err) {
            console.error('users table create error', err);
        }
    });

    db.all("PRAGMA table_info(users)", [], (err, columns) => {
        if (err) {
            console.error('PRAGMA users error', err);
            return;
        }

        const existingColumns = new Set(columns.map((column) => column.name));
        const migrations = [
            ["city", "TEXT DEFAULT 'Hyderabad'"],
            ["state", "TEXT DEFAULT 'Telangana'"],
            ["country", "TEXT DEFAULT 'India'"],
            ["photo", "TEXT DEFAULT 'https://i.pravatar.cc/150'"],
        ];

        migrations.forEach(([columnName, definition]) => {
            if (!existingColumns.has(columnName)) {
                db.run(`ALTER TABLE users ADD COLUMN ${columnName} ${definition}`);
            }
        });
    });
});

db.run(` create table if not exists trips (
    
    id integer primary key autoincrement,
    title TEXT,
    location TEXT,
    price TEXT,
    image TEXT
    )`)

db.run(`
CREATE TABLE IF NOT EXISTS destinations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    country TEXT,
    image TEXT
)
`);

db.run(`
INSERT OR IGNORE INTO destinations (id, name, country, image)
VALUES
(
1,
'Bali',
'Indonesia',
'https://images.unsplash.com/photo-1537996194471-e657df975ab4'
),
(
2,
'Paris',
'France',
'https://images.unsplash.com/photo-1502602898657-3e91760cbb34'
),
(
3,
'Tokyo',
'Japan',
'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf'
),
(
4,
'Dubai',
'UAE',
'https://images.unsplash.com/photo-1512453979798-5ea266f8880c'
),
(
5,
'Maldives',
'Indian Ocean',
'https://images.unsplash.com/photo-1507525428034-b723cf961d3e'
);
`);

app.get("/destinations/:id", (req, res) => {
    const { id } = req.params;

    db.get(
        "select * from destinations where id=?", [id],
        (err, row) => {
            if (err) {
                return res.status(500).json({
                    message: "Error"
                })
            }
            res.json(row)

        }
    )
})

app.post("/create-order", async (req, res) => {
    try {
        const { amount } = req.body;

        const options = {
            amount: amount * 100,
            currency: "INR",
            receipt: `receipt_${Date.now()}`,
        };

        const order = await razorpay.orders.create(options);

        res.json({
            success: true,
            order,
        });

    } catch (error) {
        console.error("Razorpay Error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to create order",
        });
    }
});

app.get('/destinations', async (req, res) => {
    db.all("select * from destinations",
        [],
        (err, rows) => {
            if (err) {
                return res.status(500).json({
                    message: "failed"
                })
            }
            res.json(rows)
        }
    )
})

app.get('/trips', async (req, res) => {
    db.all(
        "select * from trips",
        [],
        (err, rows) => {
            if (err) {
                console.log("SQLite Error:", err);

                return res.status(500).json({
                    message: "Failed to fetch trips",
                    error: err.message
                });
            }
            res.json(rows)
        }
    )
})


app.post("/register", async (req, res) => {

    const { name, email, password } = req.body;

    const hashedPass = await bcrypt.hash(password, 10);

    db.run(
        "insert into users(name, email, password) values (?, ?, ?)",
        [name, email, hashedPass],

        function (err) {

            if (err) {
                return res.status(400).json({
                    message: "User already exists"
                });
            }

            const token = jwt.sign(
                {
                    id: this.lastID
                },
                SECRET,
                {
                    expiresIn: "7d"
                }
            );

            res.cookie("token", token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
                maxAge: 7 * 24 * 60 * 60 * 1000
            })
            // In development add a readable cookie for debugging so frontend can
            // verify the cookie was received. This is NOT used for auth and
            // remains HttpOnly=false only in non-production environments.
            if (process.env.NODE_ENV !== "production") {
                res.cookie("dev_token", token, {
                    httpOnly: false,
                    secure: false,
                    sameSite: "lax",
                    maxAge: 7 * 24 * 60 * 60 * 1000,
                });
            }
            res.json({
                message: "Register succesfully"
            })

        }
    );
});

app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    db.get(
        "select * from users where email=?",
        [email],

        async (err, user) => {
            if (!user) {
                return res.status(400).json({
                    message: "Invalid Email"
                })
            }
            const isMatch = await bcrypt.compare(
                password,
                user.password
            );
            if (!isMatch) {

                return res.status(400).json({
                    message: "Invalid password"
                })
            }
            const token = jwt.sign(
                {
                    id: user.id
                },
                SECRET,
                {
                    expiresIn: "7d"
                }
            );
            res.cookie("token", token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
                maxAge: 7 * 24 * 60 * 60 * 1000
            })
            if (process.env.NODE_ENV !== "production") {
                res.cookie("dev_token", token, {
                    httpOnly: false,
                    secure: false,
                    sameSite: "lax",
                    maxAge: 7 * 24 * 60 * 60 * 1000,
                });
            }
            res.json({
                message: "Login succesfully"
            })
        }
    )
})

app.get("/profile", auth, (req, res) => {
    if (process.env.NODE_ENV !== "production") {
        console.log('/profile called, req.user=', req.user);
    }

    db.get(
        `SELECT id, name, email, city, state, country, photo
FROM users
WHERE id = ?`,
        [req.user.id],
        (err, user) => {

            if (err) {
                if (process.env.NODE_ENV !== "production") {
                    console.error('DB error in /profile', err);
                    console.error('req.user', req.user);
                }
                return res.status(500).json({
                    message: "Database Error"
                });
            }

            if (!user) {
                return res.status(404).json({
                    message: "User Not Found"
                });
            }

            res.json(user);

        }
    );

});

app.put('/profile', auth, (req, res) => {
    const { name, city, state, country, photo } = req.body;

    db.run(`
        update users SET 
        name=?,
        city=?,
        state=?,
        country=?,
        photo =?
    
        where id = ?
        `,
        [
            name,
            city,
            state,
            country,
            photo,
            req.user.id
        ],

        function (err) {
            if (err) {
                return res.status(500).json({
                    message: "Update Failed"
                })
            }
            res.json({
                message: "Profile Updated Successfully"
            })
        }
    )
})

app.post("/logout", async (req, res) => {
    res.clearCookie("token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    });

    res.json({
        message: "Logout Done "
    })
})

app.post('/trips', async (req, res) => {
    const { title, location, price, image } = req.body;

    db.run(
        `
    INSERT INTO trips(title, location, price, image)
    VALUES (?, ?, ?, ?)
    `,
        [title, location, price, image],
        function (err) {
            if (err) {
                return res.status(500).json({
                    message: "Failed to add trip"
                });
            }

            res.json({
                id: this.lastID,
                message: "Trip added successfully"
            });
        }
    );
})


app.get("/", async (req, res) => {
    res.send("Backend is running bruuuuu")
})

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});