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

let razorpay;
try {
    razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
    })
} catch (error) {
    console.warn('Warning: Razorpay initialization failed. Payments may not work.', error.message);
}



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
            ["updated_at", "TEXT"]
        ];

        let updatedAtColumnAdded = false;

        const addNextColumn = (index = 0) => {
            if (index >= migrations.length) {
                if (updatedAtColumnAdded) {
                    db.run(
                        `UPDATE users SET updated_at = datetime('now') WHERE updated_at IS NULL`,
                        (err) => {
                            if (err) {
                                console.error('Error updating updated_at values', err);
                            }
                        }
                    );
                }
                return;
            }

            const [columnName, definition] = migrations[index];
            if (!existingColumns.has(columnName)) {
                db.run(`ALTER TABLE users ADD COLUMN ${columnName} ${definition}`, (err) => {
                    if (err) {
                        console.error(`Error adding column ${columnName}:`, err.message);
                    } else if (columnName === "updated_at") {
                        updatedAtColumnAdded = true;
                    }
                    addNextColumn(index + 1);
                });
            } else {
                if (columnName === "updated_at") {
                    updatedAtColumnAdded = true;
                }
                addNextColumn(index + 1);
            }
        };

        addNextColumn();
    });
});

db.run(` create table if not exists trips (
    
    id integer primary key autoincrement,
    title TEXT,
    location TEXT,
    price TEXT,
    image TEXT,
    user_id INTEGER
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
    create table if not exists followers (
    id integer primary key autoincrement,
    follower_id integer,
    following_id integer,
    created_at datetime default current_timestamp,
    unique(follower_id,  following_id)
    )
    `);

db.run(`
CREATE TABLE IF NOT EXISTS likes(

id INTEGER PRIMARY KEY AUTOINCREMENT,

user_id INTEGER,

trip_id INTEGER,

UNIQUE(user_id, trip_id)

)
`);

db.run(`
CREATE TABLE IF NOT EXISTS comments(

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    user_id INTEGER,

    trip_id INTEGER,

    comment TEXT,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP

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
        if (!razorpay) {
            return res.status(500).json({
                success: false,
                message: "Razorpay not configured",
            });
        }

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

app.get("/followers-count/:id", (req, res) => {
    db.get(`
        select count(*) as count from followers where following_id = ? 
        `, [req.params.id],

        (err, row) => {
            if (err) {
                return res.status(500).json({
                    message: "Database err broo"
                })
            }

            res.json(row)
        }
    )
})


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

app.get('/users', (req, res) => {
    db.all(`
        select id, name, city, state, country, photo from users order by updated_at desc, id desc
        `,
        [],
        (err, rows) => {
            if (err) {
                return res.status(500).json({
                    message: "Database error"
                })
            }
            res.json(rows)
        }
    )
})

app.get("/search-users", (req, res) => {
    const search = req.query.search || ""
    db.all(`
      select id, name, city, state, country, photo from users
      where name like ?
      order by updated_at desc, id desc
        `, [`%${search}%`],

        (err, rows) => {
            if (err) {
                return res.status(500).json({
                    message: "Database err"
                })
            }
            res.json(rows)
        }
    )
})

app.get("/users/:id", (req, res) => {

    const { id } = req.params;

    db.get(
        `
        SELECT
            id,
            name,
            email,
            city,
            state,
            country,
            photo
        FROM users
        WHERE id = ?
        `,
        [id],
        (err, row) => {

            if (err) {
                return res.status(500).json({
                    message: "Database Error"
                });
            }

            if (!row) {
                return res.status(404).json({
                    message: "User Not Found"
                });
            }

            res.json(row);

        }
    );

});

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

app.get("/users/:id/trips", (req, res) => {

    db.all(
        `
        SELECT *
        FROM trips
        WHERE user_id = ?
        `,
        [req.params.id],

        (err, rows) => {

            if (err) {
                return res.status(500).json({
                    message: "Database Error"
                });
            }

            res.json(rows);

        }

    );

});


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
                maxAge: 7 * 24 * 60 * 60 * 1000,
            });
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

    console.log("Email entered:", email);

    db.get(
        "SELECT * FROM users WHERE email=?",
        [email],

        async (err, user) => {

            if (!user) {
                return res.status(400).json({
                    message: "Invalid Email"
                });
            }

            console.log("User found:", user.id, user.name, user.email);

            const isMatch = await bcrypt.compare(password, user.password);

            if (!isMatch) {
                return res.status(400).json({
                    message: "Invalid password"
                });
            }

            console.log("Logging in user:", user.id);
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
                maxAge: 7 * 24 * 60 * 60 * 1000,
            });
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
        photo =?,
        updated_at = CURRENT_TIMESTAMP
    
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

app.post('/trips', auth, (req, res) => {
    const { title, location, price, image, user_id } = req.body;

    db.run(
        `
    INSERT INTO trips(title, location, price, image, user_id)
VALUES (?, ?, ?, ?, ?)
    `,
        [
            title,
            location,
            price,
            image,
            req.user.id
        ],
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

app.post('/follow/:id', auth, (req, res) => {
    const followerId = req.user.id;
    const followingId = req.params.id;

    if (followerId == followingId) {
        return res.status(400).json({
            message: "You cant follow yourself brooo"
        });
    }

    db.run(
        `
        insert into followers (follower_id, following_id)
        values(?, ?)
        `,
        [followerId, followingId],
        function (err) {
            if (err) {
                return res.status(400).json({
                    message: "You're already following this user"
                });
            }
            res.json({
                message: "Followed successfully"
            });
        }
    );
});

app.delete('/unfollow/:id', auth, (req, res) => {
    const followerId = req.user.id;
    const followingId = req.params.id;

    db.run(
        `
        delete from followers where follower_id = ? and following_id = ?
        `,
        [followerId, followingId],
        function (err) {
            if (err) {
                return res.status(500).json({
                    message: "You cant unfollow"
                });
            }
            res.json({
                message: "Unfollowed successfully"
            });
        }
    );
});

app.get('/follow-status/:id', auth, (req, res) => {
    const followerId = req.user.id;
    const followingId = req.params.id;

    db.get(`
        select * from followers
        where follower_id = ? and following_id = ?

        `, [followerId, followingId],

        (err, row) => {
            if (err) {
                res.status(500).json({
                    message: "error broooo"
                })
            }

            res.json({
                following: !!row
            })
        }

    )
})

app.get("/following-count/:id", (req, res) => {

    db.get(`
        SELECT COUNT(*) AS count
        FROM followers
        WHERE follower_id = ?
    `,
        [req.params.id],

        (err, row) => {

            if (err) {
                return res.status(500).json({
                    message: "Database error"
                });
            }

            res.json(row);

        });

});

app.post("/like/:id", auth, (req, res) => {

    db.run(`
        insert into likes(user_id, trip_id)
        values(?, ?)
        `,
        [req.user.id, req.params.id],

        function (err) {
            if (err) {
                return res.status(500).json({
                    message: "Already Liked broo"
                })
            }
            res.json({
                message: "Liked successfully"
            })
        }
    )
})

app.delete("/unlike/:id", auth, (req, res) => {

    db.run(`
     delete from likes 
     where user_id = ? and trip_id = ? 
        `, [req.user.id, req.params.id],

        function (err) {
            if (err) {
                return res.status(500).json({
                    message: "Database error"
                })
            }

            res.json({
                message: "Unliked successfully"
            })
        }
    )
})

app.get("/likes-count/:id", (req, res) => {
    db.get(`
       select count(*) as count 
       from likes 
       where trip_id=?
        `, [req.params.id],

        (err, row) => {
            if (err) {
                return res.status(500).json({
                    message: "DB err"
                })
            }
            res.json(row)
        }

    )
})

app.get("/check-like/:id", auth, (req, res) => {

    db.get(
        `
        SELECT *
        FROM likes
        WHERE user_id = ?
        AND trip_id = ?
        `,
        [req.user.id, req.params.id],

        (err, row) => {

            if (err) {

                return res.status(500).json({
                    message: "Database Error"
                });

            }

            res.json({
                liked: !!row
            });

        }

    );

});

app.post("/comments/:tripId", auth, (req, res) => {

    console.log("========== COMMENT DEBUG ==========");
    console.log("Cookie:", req.cookies.token);
    console.log("req.user:", req.user);
    console.log("Comment:", req.body.comment);
    console.log("Trip:", req.params.tripId);

    db.run(
        `
        INSERT INTO comments(user_id, trip_id, comment)
        VALUES (?, ?, ?)
        `,
        [
            req.user.id,
            req.params.tripId,
            req.body.comment
        ],
        function (err) {

            if (err) {
                console.log(err);
                return res.status(500).json({
                    message: "Database Error"
                });
            }

            console.log("Inserted row id:", this.lastID);

            res.json({
                message: "Comment Added",
                loggedUserId: req.user.id
            });

        }
    );

});

app.get("/comments/:tripId", (req, res) => {

    db.all(
        `
        SELECT
            comments.id,
            comments.comment,
            comments.created_at,
            users.name,
            users.photo
        FROM comments
        JOIN users
        ON comments.user_id = users.id
        WHERE comments.trip_id = ?
        ORDER BY comments.created_at DESC
        `,
        [req.params.tripId],

        (err, rows) => {

            if (err) {

                return res.status(500).json({
                    message: "Database Error"
                });

            }

            res.json(rows);

        }

    );

});

app.get("/all-users", (req, res) => {

    db.all(
        "SELECT id, name, email FROM users",
        [],
        (err, rows) => {

            if (err) {
                return res.status(500).json({
                    message: "Database Error"
                });
            }

            res.json(rows);

        }
    );

});

app.get("/comments-debug", (req, res) => {

    db.all(
        `
        SELECT *
        FROM comments
        `,
        [],
        (err, rows) => {

            if (err) {
                return res.status(500).json(err);
            }

            res.json(rows);

        }
    );

});


app.get("/", async (req, res) => {
    res.send("Backend is running bruuuuu")
})

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});


process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err.message);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});