const express = require('express')
const sqlite3 = require('sqlite3').verbose()
const cors = require('cors')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')

const app = express()
app.use(cors())
app.use(express.json())

const db = new sqlite3.Database('./travel.db');

const SECRET = "travel_secret_key"

db.run(` create table if not exists users(
    id integer primary key autoincrement,
    name TEXT,
    email TEXT UNIQUE,
    password TEXT
    )`)

db.run(` create table if not exists trips (
    
    id integer primary key autoincrement,
    title TEXT,
    location TEXT,
    price TEXT,
    image TEXT
    )`)

app.get('/trips', async (req,res)=>{
 db.all(
    "select * from trips",
    [],
    (err, rows) =>{
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

            res.json({
                token
            });
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
            res.json({
                token
            })
        }
    )
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