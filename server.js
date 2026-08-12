const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const dotenv = require("dotenv");
const Razorpay = require("razorpay");
const cookieParser = require("cookie-parser");

const auth = require("./middleware/auth");

dotenv.config();

const app = express();

/* =========================================================
   CONFIG
========================================================= */

const PORT = process.env.PORT || 3000;

const SECRET =
    process.env.JWT_SECRET || "travel_secret_key";

const isProduction =
    process.env.NODE_ENV === "production";

const allowedOrigins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "https://travel-dashboard-sklj.vercel.app",
];

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(
    cors({
        origin: (origin, callback) => {

            // Postman / server-to-server
            if (!origin) {
                return callback(null, true);
            }

            if (allowedOrigins.includes(origin)) {
                return callback(null, true);
            }

            console.log("❌ Blocked CORS origin:", origin);

            return callback(
                new Error(`Origin ${origin} not allowed by CORS`)
            );
        },

        credentials: true,
    })
);

app.use(express.json());
app.use(cookieParser());

/* =========================================================
   DATABASE
========================================================= */

const dbPath = path.join(__dirname, "travel.db");

const db = new sqlite3.Database(
    dbPath,
    (err) => {

        if (err) {
            console.error(
                "❌ SQLite connection failed:",
                err.message
            );
        } else {
            console.log(
                "✅ SQLite connected:",
                dbPath
            );
        }

    }
);

/* =========================================================
   RAZORPAY
========================================================= */

let razorpay = null;

if (
    process.env.RAZORPAY_KEY_ID &&
    process.env.RAZORPAY_KEY_SECRET
) {

    try {

        razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET,
        });

        console.log("✅ Razorpay initialized");

    } catch (error) {

        console.error(
            "❌ Razorpay initialization failed:",
            error.message
        );

    }

} else {

    console.log(
        "⚠️ Razorpay keys not configured"
    );

}

/* =========================================================
   DB HELPERS
========================================================= */

function run(sql, params = []) {

    return new Promise((resolve, reject) => {

        db.run(
            sql,
            params,
            function (err) {

                if (err) {
                    reject(err);
                } else {
                    resolve({
                        lastID: this.lastID,
                        changes: this.changes,
                    });
                }

            }
        );

    });

}

function all(sql, params = []) {

    return new Promise((resolve, reject) => {

        db.all(
            sql,
            params,
            (err, rows) => {

                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }

            }
        );

    });

}

function get(sql, params = []) {

    return new Promise((resolve, reject) => {

        db.get(
            sql,
            params,
            (err, row) => {

                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }

            }
        );

    });

}

/* =========================================================
   DATABASE INITIALIZATION
========================================================= */

async function initializeDatabase() {

    console.log("=================================");
    console.log("🔧 Initializing SQLite database");
    console.log("=================================");

    /* =====================================================
       USERS
    ===================================================== */

    await run(`
        CREATE TABLE IF NOT EXISTS users (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            name TEXT,

            email TEXT UNIQUE,

            password TEXT,

            city TEXT DEFAULT 'Hyderabad',

            state TEXT DEFAULT 'Telangana',

            country TEXT DEFAULT 'India',

            photo TEXT DEFAULT 'https://i.pravatar.cc/150',

            updated_at TEXT,

            instagram TEXT DEFAULT '',

            facebook TEXT DEFAULT '',

            twitter TEXT DEFAULT '',

            linkedin TEXT DEFAULT '',

            youtube TEXT DEFAULT '',

            tiktok TEXT DEFAULT '',

            website TEXT DEFAULT ''

        )
    `);

    console.log("✅ users table ready");

    /* =====================================================
       USERS MIGRATIONS
    ===================================================== */

    const userColumns = await all(
        "PRAGMA table_info(users)"
    );

    const existingUserColumns =
        new Set(
            userColumns.map(
                column => column.name
            )
        );

    const userMigrations = [

        [
            "city",
            "TEXT DEFAULT 'Hyderabad'"
        ],

        [
            "state",
            "TEXT DEFAULT 'Telangana'"
        ],

        [
            "country",
            "TEXT DEFAULT 'India'"
        ],

        [
            "photo",
            "TEXT DEFAULT 'https://i.pravatar.cc/150'"
        ],

        [
            "updated_at",
            "TEXT"
        ],

        [
            "instagram",
            "TEXT DEFAULT ''"
        ],

        [
            "facebook",
            "TEXT DEFAULT ''"
        ],

        [
            "twitter",
            "TEXT DEFAULT ''"
        ],

        [
            "linkedin",
            "TEXT DEFAULT ''"
        ],

        [
            "youtube",
            "TEXT DEFAULT ''"
        ],

        [
            "tiktok",
            "TEXT DEFAULT ''"
        ],

        [
            "website",
            "TEXT DEFAULT ''"
        ],

    ];

    for (
        const [column, definition]
        of userMigrations
    ) {

        if (
            !existingUserColumns.has(column)
        ) {

            try {

                await run(`
                    ALTER TABLE users
                    ADD COLUMN ${column} ${definition}
                `);

                console.log(
                    `✅ Added users.${column}`
                );

            } catch (error) {

                console.error(
                    `❌ Failed adding users.${column}:`,
                    error.message
                );

            }

        }

    }

    await run(`
        UPDATE users
        SET updated_at = datetime('now')
        WHERE updated_at IS NULL
    `);

    /* =====================================================
       TRIPS
    ===================================================== */

    await run(`
        CREATE TABLE IF NOT EXISTS trips (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            title TEXT,

            location TEXT,

            price TEXT,

            image TEXT,

            user_id INTEGER

        )
    `);

    console.log("✅ trips table exists");

    /* =====================================================
       TRIPS MIGRATION
    ===================================================== */

    const tripColumns = await all(
        "PRAGMA table_info(trips)"
    );

    const existingTripColumns =
        new Set(
            tripColumns.map(
                column => column.name
            )
        );

    console.log(
        "📋 Existing trips columns:",
        [...existingTripColumns]
    );

    if (
        !existingTripColumns.has("user_id")
    ) {

        console.log(
            "⚠️ trips.user_id missing. Adding it..."
        );

        await run(`
            ALTER TABLE trips
            ADD COLUMN user_id INTEGER
        `);

        console.log(
            "✅ trips.user_id added successfully"
        );

    } else {

        console.log(
            "✅ trips.user_id already exists"
        );

    }

    /* =====================================================
       DESTINATIONS
    ===================================================== */

    await run(`
        CREATE TABLE IF NOT EXISTS destinations (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            name TEXT,

            country TEXT,

            image TEXT

        )
    `);

    console.log(
        "✅ destinations table ready"
    );

    /* =====================================================
       FOLLOWERS
    ===================================================== */

    await run(`
        CREATE TABLE IF NOT EXISTS followers (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            follower_id INTEGER,

            following_id INTEGER,

            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            UNIQUE(
                follower_id,
                following_id
            )

        )
    `);

    console.log(
        "✅ followers table ready"
    );

    /* =====================================================
       LIKES
    ===================================================== */

    await run(`
        CREATE TABLE IF NOT EXISTS likes (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            user_id INTEGER,

            trip_id INTEGER,

            UNIQUE(
                user_id,
                trip_id
            )

        )
    `);

    console.log(
        "✅ likes table ready"
    );

    /* =====================================================
       COMMENTS
    ===================================================== */

    await run(`
        CREATE TABLE IF NOT EXISTS comments (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            user_id INTEGER,

            trip_id INTEGER,

            comment TEXT,

            created_at DATETIME DEFAULT CURRENT_TIMESTAMP

        )
    `);

    console.log(
        "✅ comments table ready"
    );

    /* =====================================================
       DEFAULT DESTINATIONS
    ===================================================== */

    await run(`
        INSERT OR IGNORE INTO destinations
        (id, name, country, image)

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
        )
    `);

    console.log(
        "✅ Default destinations ready"
    );

    /* =====================================================
       FINAL SCHEMA CHECK
    ===================================================== */

    const finalTripColumns = await all(
        "PRAGMA table_info(trips)"
    );

    console.log(
        "================================="
    );

    console.log(
        "🚀 FINAL trips schema:"
    );

    console.log(
        finalTripColumns.map(
            column => column.name
        )
    );

    console.log(
        "================================="
    );

}

/* =========================================================
   HOME
========================================================= */

app.get("/", (req, res) => {

    res.json({
        success: true,
        message:
            "TravelHub Backend is running 🚀",
    });

});

/* =========================================================
   DESTINATIONS
========================================================= */

app.get(
    "/destinations",
    async (req, res) => {

        try {

            const rows = await all(`
                SELECT *
                FROM destinations
                ORDER BY id ASC
            `);

            res.json(rows);

        } catch (error) {

            console.error(
                "Destinations error:",
                error
            );

            res.status(500).json({
                message:
                    "Failed to load destinations",
                error:
                    error.message,
            });

        }

    }
);

app.get(
    "/destinations/:id",
    async (req, res) => {

        try {

            const row = await get(
                `
                SELECT *
                FROM destinations
                WHERE id = ?
                `,
                [req.params.id]
            );

            if (!row) {

                return res.status(404).json({
                    message:
                        "Destination not found",
                });

            }

            res.json(row);

        } catch (error) {

            res.status(500).json({
                message:
                    "Database Error",
                error:
                    error.message,
            });

        }

    }
);

/* =========================================================
   RAZORPAY
========================================================= */

app.post(
    "/create-order",
    async (req, res) => {

        try {

            if (!razorpay) {

                return res.status(500).json({
                    success: false,
                    message:
                        "Razorpay is not configured",
                });

            }

            const amount =
                Number(req.body.amount);

            if (
                !amount ||
                amount <= 0
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid amount",
                });

            }

            const order =
                await razorpay.orders.create({

                    amount:
                        Math.round(
                            amount * 100
                        ),

                    currency: "INR",

                    receipt:
                        `receipt_${Date.now()}`,

                });

            res.json({
                success: true,
                order,
            });

        } catch (error) {

            console.error(
                "Razorpay error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Unable to create order",
                error:
                    error.message,
            });

        }

    }
);

/* =========================================================
   USERS
========================================================= */

app.get(
    "/users",
    async (req, res) => {

        try {

            const rows = await all(`
                SELECT
                    id,
                    name,
                    city,
                    state,
                    country,
                    photo

                FROM users

                ORDER BY
                    updated_at DESC,
                    id DESC
            `);

            res.json(rows);

        } catch (error) {

            console.error(
                "Users error:",
                error
            );

            res.status(500).json({
                message:
                    "Database error",
                error:
                    error.message,
            });

        }

    }
);

/* =========================================================
   SEARCH USERS
========================================================= */

app.get(
    "/search-users",
    async (req, res) => {

        try {

            const search =
                req.query.search || "";

            const rows = await all(
                `
                SELECT
                    id,
                    name,
                    city,
                    state,
                    country,
                    photo

                FROM users

                WHERE name LIKE ?

                ORDER BY
                    updated_at DESC,
                    id DESC
                `,
                [`%${search}%`]
            );

            res.json(rows);

        } catch (error) {

            res.status(500).json({
                message:
                    "Database error",
                error:
                    error.message,
            });

        }

    }
);

/* =========================================================
   ALL USERS
========================================================= */

app.get(
    "/all-users",
    async (req, res) => {

        try {

            const rows = await all(`
                SELECT
                    id,
                    name,
                    email
                FROM users
            `);

            res.json(rows);

        } catch (error) {

            res.status(500).json({
                message:
                    "Database Error",
                error:
                    error.message,
            });

        }

    }
);

/* =========================================================
   SINGLE USER
========================================================= */

app.get(
    "/users/:id",
    async (req, res) => {

        try {

            const user =
                await get(
                    `
                    SELECT

                        id,
                        name,
                        email,

                        city,
                        state,
                        country,

                        photo,

                        instagram,
                        facebook,
                        twitter,
                        linkedin,
                        youtube,
                        tiktok,
                        website

                    FROM users

                    WHERE id = ?
                    `,
                    [req.params.id]
                );

            if (!user) {

                return res.status(404).json({
                    error:
                        "User not found",
                });

            }

            res.json(user);

        } catch (error) {

            console.error(
                "Single user error:",
                error
            );

            res.status(500).json({
                error:
                    "Failed to fetch user",
                details:
                    error.message,
            });

        }

    }
);

/* =========================================================
   ALL TRIPS
========================================================= */

app.get(
    "/trips",
    async (req, res) => {

        try {

            const rows = await all(`
                SELECT
                    id,
                    title,
                    location,
                    price,
                    image,
                    user_id

                FROM trips

                ORDER BY id DESC
            `);

            res.json(rows);

        } catch (error) {

            console.error(
                "❌ ALL TRIPS ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Failed to fetch trips",
                error:
                    error.message,
            });

        }

    }
);

/* =========================================================
   USER TRIPS
========================================================= */
/* =========================================================
   USER TRIPS
========================================================= */

app.get("/users/:id/trips", (req, res) => {

    const userId = req.params.id;

    console.log("📍 Loading trips for user:", userId);

    db.all(
        `
        SELECT
            id,
            title,
            location,
            price,
            image,
            user_id
        FROM trips
        WHERE user_id = ?
        ORDER BY id DESC
        `,
        [userId],
        (err, rows) => {

            if (err) {

                console.error(
                    "❌ USER TRIPS ERROR:",
                    err.message
                );

                return res.status(500).json({
                    success: false,
                    message: "Failed to load user trips",
                    error: err.message
                });
            }

            console.log(
                "✅ Trips found:",
                rows.length
            );

            res.json(rows);
        }
    );
});

/* =========================================================
   REGISTER
========================================================= */

app.post(
    "/register",
    async (req, res) => {

        try {

            const {
                name,
                email,
                password,
            } = req.body;

            if (
                !name ||
                !email ||
                !password
            ) {

                return res.status(400).json({
                    message:
                        "Name, email and password are required",
                });

            }

            const hashedPassword =
                await bcrypt.hash(
                    password,
                    10
                );

            const result =
                await run(
                    `
                    INSERT INTO users
                    (
                        name,
                        email,
                        password,
                        updated_at
                    )

                    VALUES
                    (
                        ?,
                        ?,
                        ?,
                        datetime('now')
                    )
                    `,
                    [
                        name,
                        email,
                        hashedPassword,
                    ]
                );

            const token =
                jwt.sign(
                    {
                        id:
                            result.lastID,
                    },
                    SECRET,
                    {
                        expiresIn:
                            "7d",
                    }
                );

            setAuthCookies(
                res,
                token
            );

            res.json({
                success: true,
                message:
                    "Register successfully",
            });

        } catch (error) {

            console.error(
                "Register error:",
                error
            );

            if (
                error.message.includes(
                    "UNIQUE"
                )
            ) {

                return res.status(400).json({
                    message:
                        "User already exists",
                });

            }

            res.status(500).json({
                message:
                    "Registration failed",
                error:
                    error.message,
            });

        }

    }
);

/* =========================================================
   LOGIN
========================================================= */

app.post(
    "/login",
    async (req, res) => {

        try {

            const {
                email,
                password,
            } = req.body;

            const user =
                await get(
                    `
                    SELECT *
                    FROM users
                    WHERE email = ?
                    `,
                    [email]
                );

            if (!user) {

                return res.status(400).json({
                    message:
                        "Invalid Email",
                });

            }

            const valid =
                await bcrypt.compare(
                    password,
                    user.password
                );

            if (!valid) {

                return res.status(400).json({
                    message:
                        "Invalid password",
                });

            }

            const token =
                jwt.sign(
                    {
                        id:
                            user.id,
                    },
                    SECRET,
                    {
                        expiresIn:
                            "7d",
                    }
                );

            setAuthCookies(
                res,
                token
            );

            res.json({
                success: true,
                message:
                    "Login successfully",
            });

        } catch (error) {

            console.error(
                "Login error:",
                error
            );

            res.status(500).json({
                message:
                    "Login failed",
                error:
                    error.message,
            });

        }

    }
);

/* =========================================================
   COOKIE HELPER
========================================================= */

function setAuthCookies(
    res,
    token
) {

    const cookieOptions = {

        httpOnly: true,

        secure:
            isProduction,

        sameSite:
            isProduction
                ? "none"
                : "lax",

        maxAge:
            7 *
            24 *
            60 *
            60 *
            1000,

        path: "/",

    };

    res.cookie(
        "token",
        token,
        cookieOptions
    );

    /*
       Dev token only for local development.
    */

    if (!isProduction) {

        res.cookie(
            "dev_token",
            token,
            {
                httpOnly: false,
                secure: false,
                sameSite: "lax",
                maxAge:
                    7 *
                    24 *
                    60 *
                    60 *
                    1000,
                path: "/",
            }
        );

    }

}

/* =========================================================
   CURRENT PROFILE
========================================================= */

app.get(
    "/profile",
    auth,
    async (req, res) => {

        try {

            const user =
                await get(
                    `
                    SELECT

                        id,
                        name,
                        email,

                        city,
                        state,
                        country,

                        photo,

                        instagram,
                        facebook,
                        twitter,
                        linkedin,
                        youtube,
                        tiktok,
                        website

                    FROM users

                    WHERE id = ?
                    `,
                    [req.user.id]
                );

            if (!user) {

                return res.status(404).json({
                    message:
                        "User Not Found",
                });

            }

            res.json(user);

        } catch (error) {

            console.error(
                "Profile error:",
                error
            );

            res.status(500).json({
                message:
                    "Database Error",
                error:
                    error.message,
            });

        }

    }
);

/* =========================================================
   UPDATE PROFILE + SOCIAL MEDIA
========================================================= */

app.put(
    "/profile",
    auth,
    async (req, res) => {

        try {

            const {
                name,
                city,
                state,
                country,
                photo,

                instagram,
                facebook,
                twitter,
                linkedin,
                youtube,
                tiktok,
                website,

            } = req.body;

            await run(
                `
                UPDATE users

                SET

                    name = ?,

                    city = ?,

                    state = ?,

                    country = ?,

                    photo = ?,

                    instagram = ?,

                    facebook = ?,

                    twitter = ?,

                    linkedin = ?,

                    youtube = ?,

                    tiktok = ?,

                    website = ?,

                    updated_at =
                        CURRENT_TIMESTAMP

                WHERE id = ?
                `,
                [

                    name || "",

                    city || "",

                    state || "",

                    country || "",

                    photo || "",

                    instagram || "",

                    facebook || "",

                    twitter || "",

                    linkedin || "",

                    youtube || "",

                    tiktok || "",

                    website || "",

                    req.user.id,

                ]
            );

            res.json({

                success: true,

                message:
                    "Profile Updated Successfully",

            });

        } catch (error) {

            console.error(
                "Profile update error:",
                error
            );

            res.status(500).json({
                message:
                    "Update Failed",
                error:
                    error.message,
            });

        }

    }
);

/* =========================================================
   LOGOUT
========================================================= */

app.post(
    "/logout",
    (req, res) => {

        res.clearCookie(
            "token",
            {
                httpOnly: true,
                secure:
                    isProduction,
                sameSite:
                    isProduction
                        ? "none"
                        : "lax",
                path: "/",
            }
        );

        res.clearCookie(
            "dev_token",
            {
                path: "/",
            }
        );

        res.json({
            success: true,
            message:
                "Logout Done",
        });

    }
);

/* =========================================================
   CREATE TRIP
========================================================= */

app.post(
    "/trips",
    auth,
    async (req, res) => {

        try {

            const {
                title,
                location,
                price,
                image,
            } = req.body;

            if (
                !title ||
                !location
            ) {

                return res.status(400).json({
                    message:
                        "Title and location are required",
                });

            }

            const result =
                await run(
                    `
                    INSERT INTO trips
                    (
                        title,
                        location,
                        price,
                        image,
                        user_id
                    )

                    VALUES
                    (
                        ?,
                        ?,
                        ?,
                        ?,
                        ?
                    )
                    `,
                    [
                        title,
                        location,
                        price || "",
                        image || "",
                        req.user.id,
                    ]
                );

            res.json({

                success: true,

                id:
                    result.lastID,

                message:
                    "Trip added successfully",

            });

        } catch (error) {

            console.error(
                "Create trip error:",
                error
            );

            res.status(500).json({
                message:
                    "Failed to add trip",
                error:
                    error.message,
            });

        }

    }
);

/* =========================================================
   FOLLOW
========================================================= */

app.post(
    "/follow/:id",
    auth,
    async (req, res) => {

        try {

            const followerId =
                req.user.id;

            const followingId =
                req.params.id;

            if (
                String(followerId) ===
                String(followingId)
            ) {

                return res.status(400).json({
                    message:
                        "You cannot follow yourself brooo",
                });

            }

            await run(
                `
                INSERT INTO followers
                (
                    follower_id,
                    following_id
                )

                VALUES (?, ?)
                `,
                [
                    followerId,
                    followingId,
                ]
            );

            res.json({
                success: true,
                message:
                    "Followed successfully",
            });

        } catch (error) {

            res.status(400).json({
                message:
                    "You're already following this user",
                error:
                    error.message,
            });

        }

    }
);

/* =========================================================
   UNFOLLOW
========================================================= */

app.delete(
    "/unfollow/:id",
    auth,
    async (req, res) => {

        try {

            await run(
                `
                DELETE FROM followers

                WHERE follower_id = ?

                AND following_id = ?
                `,
                [
                    req.user.id,
                    req.params.id,
                ]
            );

            res.json({
                success: true,
                message:
                    "Unfollowed successfully",
            });

        } catch (error) {

            res.status(500).json({
                message:
                    "Unable to unfollow",
                error:
                    error.message,
            });

        }

    }
);

/* =========================================================
   FOLLOW STATUS
========================================================= */

app.get(
    "/follow-status/:id",
    auth,
    async (req, res) => {

        try {

            const row =
                await get(
                    `
                    SELECT id

                    FROM followers

                    WHERE follower_id = ?

                    AND following_id = ?
                    `,
                    [
                        req.user.id,
                        req.params.id,
                    ]
                );

            res.json({
                following:
                    !!row,
            });

        } catch (error) {

            res.status(500).json({
                message:
                    "Database error",
                error:
                    error.message,
            });

        }

    }
);

/* =========================================================
   FOLLOWERS COUNT
========================================================= */

app.get(
    "/followers-count/:id",
    async (req, res) => {

        try {

            const row =
                await get(
                    `
                    SELECT
                        COUNT(*) AS count

                    FROM followers

                    WHERE following_id = ?
                    `,
                    [req.params.id]
                );

            res.json(row);

        } catch (error) {

            res.status(500).json({
                message:
                    "Database error",
                error:
                    error.message,
            });

        }

    }
);

/* =========================================================
   FOLLOWING COUNT
========================================================= */

app.get(
    "/following-count/:id",
    async (req, res) => {

        try {

            const row =
                await get(
                    `
                    SELECT
                        COUNT(*) AS count

                    FROM followers

                    WHERE follower_id = ?
                    `,
                    [req.params.id]
                );

            res.json(row);

        } catch (error) {

            res.status(500).json({
                message:
                    "Database error",
                error:
                    error.message,
            });

        }

    }
);

/* =========================================================
   LIKE
========================================================= */

app.post(
    "/like/:id",
    auth,
    async (req, res) => {

        try {

            await run(
                `
                INSERT INTO likes
                (
                    user_id,
                    trip_id
                )

                VALUES (?, ?)
                `,
                [
                    req.user.id,
                    req.params.id,
                ]
            );

            res.json({
                success: true,
                message:
                    "Liked successfully",
            });

        } catch (error) {

            res.status(400).json({
                message:
                    "Already liked broo",
                error:
                    error.message,
            });

        }

    }
);

/* =========================================================
   UNLIKE
========================================================= */

app.delete(
    "/unlike/:id",
    auth,
    async (req, res) => {

        try {

            await run(
                `
                DELETE FROM likes

                WHERE user_id = ?

                AND trip_id = ?
                `,
                [
                    req.user.id,
                    req.params.id,
                ]
            );

            res.json({
                success: true,
                message:
                    "Unliked successfully",
            });

        } catch (error) {

            res.status(500).json({
                message:
                    "Database error",
                error:
                    error.message,
            });

        }

    }
);

/* =========================================================
   LIKE COUNT
========================================================= */

app.get(
    "/likes-count/:id",
    async (req, res) => {

        try {

            const row =
                await get(
                    `
                    SELECT
                        COUNT(*) AS count

                    FROM likes

                    WHERE trip_id = ?
                    `,
                    [req.params.id]
                );

            res.json(row);

        } catch (error) {

            res.status(500).json({
                message:
                    "Database error",
                error:
                    error.message,
            });

        }

    }
);

/* =========================================================
   CHECK LIKE
========================================================= */

app.get(
    "/check-like/:id",
    auth,
    async (req, res) => {

        try {

            const row =
                await get(
                    `
                    SELECT id

                    FROM likes

                    WHERE user_id = ?

                    AND trip_id = ?
                    `,
                    [
                        req.user.id,
                        req.params.id,
                    ]
                );

            res.json({
                liked:
                    !!row,
            });

        } catch (error) {

            res.status(500).json({
                message:
                    "Database error",
                error:
                    error.message,
            });

        }

    }
);

/* =========================================================
   ADD COMMENT
========================================================= */

app.post(
    "/comments/:tripId",
    auth,
    async (req, res) => {

        try {

            const comment =
                String(
                    req.body.comment || ""
                ).trim();

            if (!comment) {

                return res.status(400).json({
                    message:
                        "Comment cannot be empty",
                });

            }

            const result =
                await run(
                    `
                    INSERT INTO comments
                    (
                        user_id,
                        trip_id,
                        comment
                    )

                    VALUES (?, ?, ?)
                    `,
                    [
                        req.user.id,
                        req.params.tripId,
                        comment,
                    ]
                );

            res.json({

                success: true,

                message:
                    "Comment Added",

                id:
                    result.lastID,

                loggedUserId:
                    req.user.id,

            });

        } catch (error) {

            console.error(
                "Comment error:",
                error
            );

            res.status(500).json({
                message:
                    "Database Error",
                error:
                    error.message,
            });

        }

    }
);

/* =========================================================
   GET COMMENTS
========================================================= */

app.get(
    "/comments/:tripId",
    async (req, res) => {

        try {

            const rows =
                await all(
                    `
                    SELECT

                        comments.id,

                        comments.comment,

                        comments.created_at,

                        users.id AS user_id,

                        users.name,

                        users.photo

                    FROM comments

                    JOIN users

                    ON comments.user_id =
                       users.id

                    WHERE comments.trip_id = ?

                    ORDER BY
                        comments.created_at DESC
                    `,
                    [req.params.tripId]
                );

            res.json(rows);

        } catch (error) {

            console.error(
                "Comments error:",
                error
            );

            res.status(500).json({
                message:
                    "Database Error",
                error:
                    error.message,
            });

        }

    }
);

/* =========================================================
   COMMENTS DEBUG
========================================================= */

app.get(
    "/comments-debug",
    async (req, res) => {

        try {

            const rows =
                await all(`
                    SELECT *
                    FROM comments
                    ORDER BY id DESC
                `);

            res.json(rows);

        } catch (error) {

            res.status(500).json({
                message:
                    "Database Error",
                error:
                    error.message,
            });

        }

    }
);

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
    (err, req, res, next) => {

        console.error(
            "❌ Express error:",
            err
        );

        res.status(500).json({
            success: false,
            message:
                err.message ||
                "Internal Server Error",
        });

    }
);

/* =========================================================
   START SERVER ONLY AFTER DATABASE IS READY
========================================================= */

async function startServer() {

    try {

        await initializeDatabase();

        app.listen(
            PORT,
            () => {

                console.log(
                    "================================="
                );

                console.log(
                    `🚀 TravelHub backend running on port ${PORT}`
                );

                console.log(
                    `🌍 Environment: ${
                        process.env.NODE_ENV ||
                        "development"
                    }`
                );

                console.log(
                    "================================="
                );

            }
        );

    } catch (error) {

        console.error(
            "❌ DATABASE INITIALIZATION FAILED"
        );

        console.error(
            error
        );

        process.exit(1);

    }

}

startServer();

/* =========================================================
   PROCESS ERRORS
========================================================= */

process.on(
    "uncaughtException",
    (error) => {

        console.error(
            "❌ Uncaught Exception:",
            error
        );

    }
);

process.on(
    "unhandledRejection",
    (reason) => {

        console.error(
            "❌ Unhandled Rejection:",
            reason
        );

    }
);