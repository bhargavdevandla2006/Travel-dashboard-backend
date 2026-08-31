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
    "https://travel-dashboard-lnfg.vercel.app"
];



/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(
    cors({
        origin: (origin, callback) => {
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
app.use(express.urlencoded({ extended: true }));
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
   DATABASE HELPERS
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


async function initializeDatabase() {

    console.log("=================================");
    console.log("🔧 Initializing SQLite database");
    console.log("=================================");


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
            website TEXT DEFAULT '',

            is_private INTEGER DEFAULT 0
        )
    `);

    const userColumns =
        await all("PRAGMA table_info(users)");

    const existingUserColumns =
        new Set(
            userColumns.map(
                column => column.name
            )
        );

    const userMigrations = [

        ["city", "TEXT DEFAULT 'Hyderabad'"],

        ["state", "TEXT DEFAULT 'Telangana'"],

        ["country", "TEXT DEFAULT 'India'"],

        [
            "photo",
            "TEXT DEFAULT 'https://i.pravatar.cc/150'"
        ],

        ["updated_at", "TEXT"],

        ["instagram", "TEXT DEFAULT ''"],
        ["facebook", "TEXT DEFAULT ''"],
        ["twitter", "TEXT DEFAULT ''"],
        ["linkedin", "TEXT DEFAULT ''"],
        ["youtube", "TEXT DEFAULT ''"],
        ["tiktok", "TEXT DEFAULT ''"],
        ["website", "TEXT DEFAULT ''"],

        ["is_private", "INTEGER DEFAULT 0"],
        ["face_descriptor", "TEXT"],
        ["face_browser_id", "TEXT"],
    ];

    for (
        const [column, definition]
        of userMigrations
    ) {
        if (!existingUserColumns.has(column)) {
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
                    `❌ Failed adding ${column}:`,
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

    db.run(`
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

    const notificationColumns =
        await all("PRAGMA table_info(notifications)");

    const existingNotificationColumns =
        new Set(
            notificationColumns.map(column => column.name)
        );

    if (!existingNotificationColumns.has("is_read")) {
        await run(`
        ALTER TABLE notifications
        ADD COLUMN is_read INTEGER DEFAULT 0
    `);

        console.log("✅ Added notifications.is_read");
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

    /* =====================================================
       FOLLOW REQUESTS
    ===================================================== */

    await run(`
        CREATE TABLE IF NOT EXISTS follow_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            sender_id INTEGER NOT NULL,

            receiver_id INTEGER NOT NULL,

            status TEXT DEFAULT 'pending',

            created_at DATETIME
            DEFAULT CURRENT_TIMESTAMP,

            UNIQUE(
                sender_id,
                receiver_id
            )
        )
    `);

    /* =====================================================
       CLOSE FRIENDS
    ===================================================== */

    await run(`
        CREATE TABLE IF NOT EXISTS close_friends (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            user_id INTEGER NOT NULL,

            friend_id INTEGER NOT NULL,

            created_at DATETIME
            DEFAULT CURRENT_TIMESTAMP,

            UNIQUE(
                user_id,
                friend_id
            )
        )
    `);

    await run(`
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        sender_id INTEGER NOT NULL,

        receiver_id INTEGER NOT NULL,

        message TEXT NOT NULL,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

    /* =====================================================
       BLOCKED USERS
    ===================================================== */

    await run(`
        CREATE TABLE IF NOT EXISTS blocked_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            user_id INTEGER NOT NULL,

            blocked_user_id INTEGER NOT NULL,

            created_at DATETIME
            DEFAULT CURRENT_TIMESTAMP,

            UNIQUE(
                user_id,
                blocked_user_id
            )
        )
    `);

    /* =====================================================
       CONTENT PREFERENCES
    ===================================================== */

    await run(`
        CREATE TABLE IF NOT EXISTS content_preferences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            user_id INTEGER UNIQUE NOT NULL,

            show_travel INTEGER DEFAULT 1,

            show_reels INTEGER DEFAULT 1,

            sensitive_content INTEGER DEFAULT 0,

            autoplay_reels INTEGER DEFAULT 1,

            updated_at DATETIME
            DEFAULT CURRENT_TIMESTAMP
        )
    `);

    /* =====================================================
       TRIP LIKES
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

    /* =====================================================
       COMMENTS
    ===================================================== */

    await run(`
        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            user_id INTEGER,

            trip_id INTEGER,

            comment TEXT,

            created_at DATETIME
            DEFAULT CURRENT_TIMESTAMP
        )
    `);

    /* =====================================================
       REELS
    ===================================================== */

    await run(`
        CREATE TABLE IF NOT EXISTS reels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            user_id INTEGER NOT NULL,

            title TEXT,

            description TEXT,

            video_url TEXT,

            thumbnail TEXT,

            visibility TEXT DEFAULT 'public',

            created_at DATETIME
            DEFAULT CURRENT_TIMESTAMP
        )
    `);

    const reelColumns =
        await all("PRAGMA table_info(reels)");

    const existingReelColumns =
        new Set(
            reelColumns.map(
                column => column.name
            )
        );

    if (
        !existingReelColumns.has(
            "visibility"
        )
    ) {
        await run(`
            ALTER TABLE reels
            ADD COLUMN visibility
            TEXT DEFAULT 'public'
        `);
    }

    /* =====================================================
       SAVED REELS
    ===================================================== */

    await run(`
        CREATE TABLE IF NOT EXISTS saved_reels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            user_id INTEGER NOT NULL,

            reel_id INTEGER NOT NULL,

            created_at DATETIME
            DEFAULT CURRENT_TIMESTAMP,

            UNIQUE(
                user_id,
                reel_id
            )
        )
    `);

    /* =====================================================
       REEL LIKES
    ===================================================== */

    await run(`
    CREATE TABLE IF NOT EXISTS reel_likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        user_id INTEGER NOT NULL,

        reel_id INTEGER NOT NULL,

        created_at DATETIME
        DEFAULT CURRENT_TIMESTAMP,

        UNIQUE(
            user_id,
            reel_id
        )
    )
`);

    const reelLikeColumns =
        await all("PRAGMA table_info(reel_likes)");

    const existingReelLikeColumns =
        new Set(
            reelLikeColumns.map(
                column => column.name
            )
        );

    if (
        !existingReelLikeColumns.has(
            "created_at"
        )
    ) {
        await run(`
        ALTER TABLE reel_likes
        ADD COLUMN created_at DATETIME
        DEFAULT CURRENT_TIMESTAMP
    `);

        console.log(
            "✅ Added reel_likes.created_at"
        );
    }

    /* =====================================================
       HIGHLIGHTS
    ===================================================== */

    await run(`
        CREATE TABLE IF NOT EXISTS highlights (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            user_id INTEGER NOT NULL,

            title TEXT NOT NULL,

            cover_image TEXT,

            created_at DATETIME
            DEFAULT CURRENT_TIMESTAMP
        )
    `);

    /* =====================================================
       HIGHLIGHT REELS
    ===================================================== */

    await run(`
        CREATE TABLE IF NOT EXISTS highlight_reels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            highlight_id INTEGER NOT NULL,

            reel_id INTEGER NOT NULL,

            UNIQUE(
                highlight_id,
                reel_id
            )
        )
    `);

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

    console.log("✅ Database initialization complete");
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
            const rows =
                await all(`
                    SELECT *
                    FROM destinations
                    ORDER BY id ASC
                `);

            res.json(rows);

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to load destinations",
            });
        }
    }
);

app.get(
    "/destinations/:id",
    async (req, res) => {
        try {
            const row =
                await get(
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
                        Math.round(amount * 100),

                    currency: "INR",

                    receipt:
                        `receipt_${Date.now()}`,
                });

            res.json({
                success: true,
                order,
            });

        } catch (error) {
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
   REGISTER
========================================================= */

app.post("/register", async (req, res) => {
    try {

        const {
            name,
            email,
            password,
            faceDescriptor,
            browserId
        } = req.body;


        // ==========================================
        // CHECK REQUIRED FIELDS
        // ==========================================

        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: "Name, email and password are required"
            });
        }


        // ==========================================
        // CHECK FACE REGISTRATION
        // ==========================================

        if (!faceDescriptor) {
            return res.status(400).json({
                success: false,
                message: "Face authentication is required"
            });
        }

        if (!browserId) {
            return res.status(400).json({
                success: false,
                message: "Browser ID is required"
            });
        }


        // ==========================================
        // HASH PASSWORD
        // ==========================================

        const hashedPassword = await bcrypt.hash(
            password,
            10
        );


        // ==========================================
        // SAVE USER
        // ==========================================

        const result = await run(
            `
            INSERT INTO users
            (
                name,
                email,
                password,
                face_descriptor,
                face_browser_id,
                updated_at
            )

            VALUES
            (
                ?,
                ?,
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

                // Convert face descriptor array
                // into a string for SQLite
                JSON.stringify(faceDescriptor),

                browserId
            ]
        );


        // ==========================================
        // CREATE JWT TOKEN
        // ==========================================

        const token = jwt.sign(
            {
                id: result.lastID
            },
            SECRET,
            {
                expiresIn: "7d"
            }
        );


        // ==========================================
        // SET AUTH COOKIE
        // ==========================================

        setAuthCookies(
            res,
            token
        );


        // ==========================================
        // SEND RESPONSE
        // ==========================================

        res.status(201).json({
            success: true,
            userId: result.lastID,
            message: "Registered successfully"
        });


    } catch (error) {

        console.error(
            "REGISTER ERROR:",
            error
        );


        // ==========================================
        // DUPLICATE EMAIL
        // ==========================================

        if (
            error.message &&
            error.message.includes("UNIQUE")
        ) {

            return res.status(400).json({
                success: false,
                message: "User already exists"
            });

        }


        // ==========================================
        // OTHER ERROR
        // ==========================================

        res.status(500).json({
            success: false,
            message: "Registration failed",
            error: error.message
        });

    }
});

/* =========================================================
   LOGIN
========================================================= */

app.post(
    "/login",
    async (req, res) => {
        try {

            const {
                email,
                password
            } = req.body;

            const user = await get(
                `
                SELECT *
                FROM users
                WHERE email = ?
                `,
                [email]
            );

            if (!user) {
                return res.status(400).json({
                    message: "Invalid Email",
                });
            }

            const valid = await bcrypt.compare(
                password,
                user.password
            );

            if (!valid) {
                return res.status(400).json({
                    message: "Invalid password",
                });
            }

            const token = jwt.sign(
                {
                    id: user.id,
                },
                SECRET,
                {
                    expiresIn: "7d",
                }
            );

            setAuthCookies(
                res,
                token
            );

            res.json({
                success: true,
                userId: user.id,
                message: "Login successfully",
            });

        } catch (error) {

            console.error(
                "LOGIN ERROR:",
                error
            );

            res.status(500).json({
                message: "Login failed",
                error: error.message,
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
                        website,

                        is_private

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
            res.status(500).json({
                message:
                    "Database Error",
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

                        is_private

                    FROM users

                    WHERE id = ?
                    `,
                    [req.params.id]
                );

            if (!user) {
                return res.status(404).json({
                    message:
                        "User not found",
                });
            }

            res.json(user);

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to fetch user",
            });
        }
    }
);

/* =========================================================
   ALL USERS
========================================================= */

app.get(
    "/users",
    async (req, res) => {
        try {

            const rows =
                await all(`
                    SELECT
                        id,
                        name,
                        city,
                        state,
                        country,
                        photo,
                        is_private

                    FROM users

                    ORDER BY
                        updated_at DESC,
                        id DESC
                `);

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
   SEARCH USERS
========================================================= */

app.get(
    "/search-users",
    async (req, res) => {
        try {

            const search =
                req.query.search || "";

            const rows =
                await all(
                    `
                    SELECT
                        id,
                        name,
                        city,
                        state,
                        country,
                        photo,
                        is_private

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
            });
        }
    }
);

/* =========================================================
   UPDATE PROFILE
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

                is_private,

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

                    is_private = ?,

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

                    is_private ? 1 : 0,

                    req.user.id,
                ]
            );

            res.json({
                success: true,
                message:
                    "Profile Updated Successfully",
            });

        } catch (error) {
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
                    (?, ?, ?, ?, ?)
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
   ALL TRIPS
========================================================= */

app.get(
    "/trips",
    async (req, res) => {
        try {

            const rows =
                await all(`
                    SELECT *
                    FROM trips
                    ORDER BY id DESC
                `);

            res.json(rows);

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to fetch trips",
            });
        }
    }
);

/* =========================================================
   USER TRIPS
========================================================= */

app.get(
    "/users/:id/trips",
    async (req, res) => {
        try {

            const rows =
                await all(
                    `
                    SELECT *
                    FROM trips

                    WHERE user_id = ?

                    ORDER BY id DESC
                    `,
                    [req.params.id]
                );

            res.json(rows);

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to load trips",
            });
        }
    }
);

/* =========================================================
   FOLLOW USER
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
                        "You cannot follow yourself",
                });
            }

            const blocked = await get(
                `
    SELECT id
    FROM blocked_users

    WHERE
        (user_id = ? AND blocked_user_id = ?)

        OR

        (user_id = ? AND blocked_user_id = ?)
    `,
                [
                    followerId,
                    followingId,
                    followingId,
                    followerId,
                ]
            );

            if (blocked) {
                return res.status(403).json({
                    message:
                        "You cannot follow this user",
                });
            }

            const targetUser =
                await get(
                    `
                    SELECT
                        is_private

                    FROM users

                    WHERE id = ?
                    `,
                    [followingId]
                );

            if (!targetUser) {
                return res.status(404).json({
                    message:
                        "User not found",
                });
            }

            if (
                targetUser.is_private
            ) {

                await run(`
    INSERT INTO follow_requests
    (
        sender_id,
        receiver_id,
        status
    )
    VALUES (?, ?, 'pending')

    ON CONFLICT(sender_id, receiver_id)

    DO UPDATE SET
        status = 'pending',
        created_at = CURRENT_TIMESTAMP
`, [
                    followerId,
                    followingId,
                ]);

                return res.json({
                    success: true,
                    requested: true,
                    message:
                        "Follow request sent",
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
                following: true,
                message:
                    "Followed successfully",
            });

        } catch (error) {
            res.status(400).json({
                message:
                    "Already following or request already sent",
            });
        }
    }
);

/* =========================================================
   FOLLOW REQUESTS
========================================================= */

app.get(
    "/follow-requests",
    auth,
    async (req, res) => {
        try {

            const requests =
                await all(
                    `
                    SELECT

                        follow_requests.id,

                        follow_requests.sender_id,

                        follow_requests.created_at,

                        users.name,

                        users.photo

                    FROM follow_requests

                    JOIN users

                    ON users.id =
                       follow_requests.sender_id

                    WHERE
                        follow_requests.receiver_id = ?

                    AND
                        follow_requests.status = 'pending'

                    ORDER BY
                        follow_requests.created_at DESC
                    `,
                    [req.user.id]
                );

            res.json(requests);

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to load requests",
            });
        }
    }
);

/* =========================================================
   ACCEPT FOLLOW REQUEST
========================================================= */

app.post(
    "/follow-requests/:id/accept",
    auth,
    async (req, res) => {
        try {

            const request =
                await get(
                    `
                    SELECT *

                    FROM follow_requests

                    WHERE id = ?

                    AND receiver_id = ?
                    `,
                    [
                        req.params.id,
                        req.user.id,
                    ]
                );

            if (!request) {
                return res.status(404).json({
                    message:
                        "Request not found",
                });
            }

            await run(
                `
                INSERT OR IGNORE INTO followers
                (
                    follower_id,
                    following_id
                )

                VALUES (?, ?)
                `,
                [
                    request.sender_id,
                    req.user.id,
                ]
            );

            await run(
                `
                UPDATE follow_requests

                SET status = 'accepted'

                WHERE id = ?
                `,
                [req.params.id]
            );

            res.json({
                success: true,
                message:
                    "Follow request accepted",
            });

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to accept request",
            });
        }
    }
);

/* =========================================================
   REJECT FOLLOW REQUEST
========================================================= */

app.post(
    "/follow-requests/:id/reject",
    auth,
    async (req, res) => {
        try {

            await run(
                `
                UPDATE follow_requests

                SET status = 'rejected'

                WHERE id = ?

                AND receiver_id = ?
                `,
                [
                    req.params.id,
                    req.user.id,
                ]
            );

            res.json({
                success: true,
                message:
                    "Follow request rejected",
            });

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to reject request",
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

            const request =
                await get(
                    `
                    SELECT id

                    FROM follow_requests

                    WHERE sender_id = ?

                    AND receiver_id = ?

                    AND status = 'pending'
                    `,
                    [
                        req.user.id,
                        req.params.id,
                    ]
                );

            res.json({
                following:
                    !!row,

                requested:
                    !!request,
            });

        } catch (error) {
            res.status(500).json({
                message:
                    "Database error",
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
            });
        }
    }
);


app.get(
    "/notifications",
    auth,
    async (req, res) => {
        try {
            const notifications = await all(
                `
                SELECT
                    id,
                    type,
                    title,
                    message,
                    is_read,
                    created_at
                FROM notifications
                WHERE user_id = ?
                ORDER BY created_at DESC
                `,
                [req.user.id]
            );

            res.json({
                success: true,
                notifications
            });

        } catch (error) {
            console.error(
                "GET NOTIFICATIONS ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message: "Failed to load notifications"
            });
        }
    }
);



/* =========================================================
   CLOSE FRIENDS
========================================================= */

app.post(
    "/close-friends/:id",
    auth,
    async (req, res) => {
        try {

            if (String(req.user.id) === String(req.params.id)) {
                return res.status(400).json({
                    message: "You cannot add yourself to close friends",
                });
            }

            await run(
                `
                INSERT INTO close_friends
                (
                    user_id,
                    friend_id
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
                    "Added to close friends",
            });

        } catch (error) {
            res.status(400).json({
                message:
                    "Already in close friends",
            });
        }
    }
);

/* =========================================================
   SEND MESSAGE
========================================================= */

app.post(
    "/messages/:id",
    auth,
    async (req, res) => {

        try {

            const receiverId = req.params.id;

            const { message } = req.body;

            if (!message || !message.trim()) {
                return res.status(400).json({
                    message: "Message cannot be empty"
                });
            }

            if (Number(receiverId) === Number(req.user.id)) {
                return res.status(400).json({
                    message: "You cannot message yourself"
                });
            }

            const result = await run(
                `
                INSERT INTO messages (
                    sender_id,
                    receiver_id,
                    message
                )
                VALUES (?, ?, ?)
                `,
                [
                    req.user.id,
                    receiverId,
                    message.trim()
                ]
            );

            res.status(201).json({
                message: "Message sent successfully",
                messageId: result.lastID
            });

        } catch (error) {

            console.error(
                "SEND MESSAGE ERROR:",
                error
            );

            res.status(500).json({
                message: "Failed to send message"
            });
        }

    }
);

/* =========================================================
   GET CONVERSATION
========================================================= */

app.get(
    "/messages/:id",
    auth,
    async (req, res) => {

        try {

            const otherUserId = req.params.id;

            const messages = await all(
                `
                SELECT
                    id,
                    sender_id,
                    receiver_id,
                    message,
                    created_at
                FROM messages
                WHERE
                    (
                        sender_id = ?
                        AND receiver_id = ?
                    )
                    OR
                    (
                        sender_id = ?
                        AND receiver_id = ?
                    )
                ORDER BY created_at ASC, id ASC
                `,
                [
                    req.user.id,
                    otherUserId,
                    otherUserId,
                    req.user.id
                ]
            );

            res.json(messages);

        } catch (error) {

            console.error(
                "GET CONVERSATION ERROR:",
                error
            );

            res.status(500).json({
                message: "Failed to load conversation"
            });
        }

    }
);

app.delete(
    "/close-friends/:id",
    auth,
    async (req, res) => {
        try {

            await run(
                `
                DELETE FROM close_friends

                WHERE user_id = ?

                AND friend_id = ?
                `,
                [
                    req.user.id,
                    req.params.id,
                ]
            );

            res.json({
                success: true,
                message:
                    "Removed from close friends",
            });

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to remove",
            });
        }
    }
);

app.get(
    "/close-friends",
    auth,
    async (req, res) => {
        try {

            const friends =
                await all(
                    `
                    SELECT
                        users.id,
                        users.name,
                        users.photo

                    FROM close_friends

                    JOIN users

                    ON users.id =
                       close_friends.friend_id

                    WHERE
                        close_friends.user_id = ?
                    `,
                    [req.user.id]
                );

            res.json(friends);

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to load close friends",
            });
        }
    }
);

/* =========================================================
   BLOCK USER
========================================================= */

app.post(
    "/block/:id",
    auth,
    async (req, res) => {
        try {

            if (
                String(req.user.id) ===
                String(req.params.id)
            ) {
                return res.status(400).json({
                    message:
                        "You cannot block yourself",
                });
            }

            await run(
                `
                INSERT INTO blocked_users
                (
                    user_id,
                    blocked_user_id
                )

                VALUES (?, ?)
                `,
                [
                    req.user.id,
                    req.params.id,
                ]
            );

            await run(
                `
                DELETE FROM followers

                WHERE

                (
                    follower_id = ?

                    AND following_id = ?
                )

                OR

                (
                    follower_id = ?

                    AND following_id = ?
                )
                `,
                [
                    req.user.id,
                    req.params.id,
                    req.params.id,
                    req.user.id,
                ]
            );

            res.json({
                success: true,
                message:
                    "User blocked",
            });

        } catch (error) {
            res.status(400).json({
                message:
                    "User already blocked",
            });
        }
    }
);

app.delete(
    "/block/:id",
    auth,
    async (req, res) => {
        try {

            await run(
                `
                DELETE FROM blocked_users

                WHERE user_id = ?

                AND blocked_user_id = ?
                `,
                [
                    req.user.id,
                    req.params.id,
                ]
            );

            res.json({
                success: true,
                message:
                    "User unblocked",
            });

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to unblock",
            });
        }
    }
);

app.get(
    "/blocked-users",
    auth,
    async (req, res) => {
        try {

            const users =
                await all(
                    `
                    SELECT
                        users.id,
                        users.name,
                        users.photo

                    FROM blocked_users

                    JOIN users

                    ON users.id =
                       blocked_users.blocked_user_id

                    WHERE
                        blocked_users.user_id = ?
                    `,
                    [req.user.id]
                );

            res.json(users);

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to load blocked users",
            });
        }
    }
);

/* =========================================================
   CONTENT PREFERENCES
========================================================= */

app.get(
    "/content-preferences",
    auth,
    async (req, res) => {
        try {

            let preferences =
                await get(
                    `
                    SELECT *

                    FROM content_preferences

                    WHERE user_id = ?
                    `,
                    [req.user.id]
                );

            if (!preferences) {

                await run(
                    `
                    INSERT INTO content_preferences
                    (
                        user_id
                    )

                    VALUES (?)
                    `,
                    [req.user.id]
                );

                preferences =
                    await get(
                        `
                        SELECT *

                        FROM content_preferences

                        WHERE user_id = ?
                        `,
                        [req.user.id]
                    );
            }

            res.json(preferences);

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to load preferences",
            });
        }
    }
);

app.put(
    "/content-preferences",
    auth,
    async (req, res) => {
        try {

            const {
                show_travel = 1,
                show_reels = 1,
                sensitive_content = 0,
                autoplay_reels = 1,
            } = req.body;

            await run(
                `
                INSERT INTO content_preferences
                (
                    user_id,
                    show_travel,
                    show_reels,
                    sensitive_content,
                    autoplay_reels
                )

                VALUES (?, ?, ?, ?, ?)

                ON CONFLICT(user_id)

                DO UPDATE SET

                    show_travel =
                        excluded.show_travel,

                    show_reels =
                        excluded.show_reels,

                    sensitive_content =
                        excluded.sensitive_content,

                    autoplay_reels =
                        excluded.autoplay_reels,

                    updated_at =
                        CURRENT_TIMESTAMP
                `,
                [
                    req.user.id,
                    show_travel ? 1 : 0,
                    show_reels ? 1 : 0,
                    sensitive_content ? 1 : 0,
                    autoplay_reels ? 1 : 0,
                ]
            );

            res.json({
                success: true,
                message:
                    "Preferences updated",
            });

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to update preferences",
            });
        }
    }
);

/* =========================================================
   CREATE REEL
========================================================= */

app.post(
    "/reels",
    auth,
    async (req, res) => {
        try {

            const {
                title,
                description,
                video_url,
                thumbnail,
                visibility,
            } = req.body;

            if (!video_url) {
                return res.status(400).json({
                    message:
                        "Video URL is required",
                });
            }

            const allowedVisibility = [
                "public",
                "followers",
                "close_friends",
            ];

            const finalVisibility =
                allowedVisibility.includes(
                    visibility
                )
                    ? visibility
                    : "public";

            const result =
                await run(
                    `
                    INSERT INTO reels
                    (
                        user_id,
                        title,
                        description,
                        video_url,
                        thumbnail,
                        visibility
                    )

                    VALUES
                    (?, ?, ?, ?, ?, ?)
                    `,
                    [
                        req.user.id,
                        title || "",
                        description || "",
                        video_url,
                        thumbnail || "",
                        finalVisibility,
                    ]
                );

            res.json({
                success: true,
                id:
                    result.lastID,
                message:
                    "Reel created successfully",
            });

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to create reel",
                error:
                    error.message,
            });
        }
    }
);

/* =========================================================
   GET ALL REELS
========================================================= */

app.get(
    "/reels",
    auth,
    async (req, res) => {
        try {

            const userId =
                req.user.id;

            const reels =
                await all(
                    `
                    SELECT

                        reels.*,

                        users.name,

                        users.photo,

                        COUNT(
                            DISTINCT reel_likes.id
                        ) AS likes_count,

                        CASE

                            WHEN EXISTS
                            (
                                SELECT 1

                                FROM reel_likes

                                WHERE
                                    reel_likes.reel_id =
                                    reels.id

                                AND
                                    reel_likes.user_id = ?
                            )

                            THEN 1

                            ELSE 0

                        END AS liked,

                        CASE

                            WHEN EXISTS
                            (
                                SELECT 1

                                FROM saved_reels

                                WHERE
                                    saved_reels.reel_id =
                                    reels.id

                                AND
                                    saved_reels.user_id = ?
                            )

                            THEN 1

                            ELSE 0

                        END AS saved

                    FROM reels

                    JOIN users

                    ON users.id =
                       reels.user_id

                    LEFT JOIN reel_likes

                    ON reel_likes.reel_id =
                       reels.id

                    WHERE

                        reels.visibility = 'public'

                    OR

                        reels.user_id = ?

                    OR

                        (
                            reels.visibility =
                            'followers'

                            AND EXISTS
                            (
                                SELECT 1

                                FROM followers

                                WHERE

                                    follower_id = ?

                                AND

                                    following_id =
                                    reels.user_id
                            )
                        )

                    OR

                        (
                            reels.visibility =
                            'close_friends'

                            AND EXISTS
                            (
                                SELECT 1

                                FROM close_friends

                                WHERE

                                    user_id =
                                    reels.user_id

                                AND

                                    friend_id = ?
                            )
                        )

                    GROUP BY reels.id

                    ORDER BY
                        reels.created_at DESC
                    `,
                    [
                        userId,
                        userId,
                        userId,
                        userId,
                        userId,
                    ]
                );

            res.json(reels);

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to load reels",
                error:
                    error.message,
            });
        }
    }
);

/* =========================================================
   GET USER REELS
========================================================= */

app.get(
    "/users/:id/reels",
    auth,
    async (req, res) => {
        try {

            const ownerId =
                req.params.id;

            const viewerId =
                req.user.id;

            const reels =
                await all(
                    `
                    SELECT *

                    FROM reels

                    WHERE user_id = ?

                    AND

                    (
                        visibility = 'public'

                        OR user_id = ?

                        OR
                        (
                            visibility = 'followers'

                            AND EXISTS
                            (
                                SELECT 1

                                FROM followers

                                WHERE

                                    follower_id = ?

                                AND

                                    following_id = ?
                            )
                        )

                        OR
                        (
                            visibility =
                            'close_friends'

                            AND EXISTS
                            (
                                SELECT 1

                                FROM close_friends

                                WHERE

                                    user_id = ?

                                AND

                                    friend_id = ?
                            )
                        )
                    )

                    ORDER BY
                        created_at DESC
                    `,
                    [
                        ownerId,
                        viewerId,
                        viewerId,
                        ownerId,
                        ownerId,
                        viewerId,
                    ]
                );

            res.json(reels);

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to load user reels",
            });
        }
    }
);

/* =========================================================
   DELETE REEL
========================================================= */

app.delete(
    "/reels/:id",
    auth,
    async (req, res) => {
        try {

            const reel = await get(
                `
                SELECT id
                FROM reels
                WHERE id = ?
                AND user_id = ?
                `,
                [
                    req.params.id,
                    req.user.id,
                ]
            );

            if (!reel) {
                return res.status(404).json({
                    message: "Reel not found",
                });
            }

            await run(`
                DELETE FROM reel_likes
                WHERE reel_id = ?
            `, [req.params.id]);

            await run(`
                DELETE FROM saved_reels
                WHERE reel_id = ?
            `, [req.params.id]);

            await run(`
                DELETE FROM highlight_reels
                WHERE reel_id = ?
            `, [req.params.id]);

            await run(`
                DELETE FROM reels
                WHERE id = ?
                AND user_id = ?
            `, [
                req.params.id,
                req.user.id,
            ]);

            res.json({
                success: true,
                message: "Reel deleted successfully",
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                message: "Failed to delete reel",
            });
        }
    }
);

/* =========================================================
   LIKE REEL
========================================================= */

app.post(
    "/reels/:id/like",
    auth,
    async (req, res) => {
        try {

            await run(
                `
                INSERT INTO reel_likes
                (
                    user_id,
                    reel_id
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
                    "Reel liked",
            });

        } catch (error) {
            res.status(400).json({
                message:
                    "Reel already liked",
            });
        }
    }
);

/* =========================================================
   UNLIKE REEL
========================================================= */

app.delete(
    "/reels/:id/like",
    auth,
    async (req, res) => {
        try {

            await run(
                `
                DELETE FROM reel_likes

                WHERE user_id = ?

                AND reel_id = ?
                `,
                [
                    req.user.id,
                    req.params.id,
                ]
            );

            res.json({
                success: true,
                message:
                    "Reel unliked",
            });

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to unlike reel",
            });
        }
    }
);

/* =========================================================
   SAVE REEL
========================================================= */

app.post(
    "/reels/:id/save",
    auth,
    async (req, res) => {
        try {

            await run(
                `
                INSERT INTO saved_reels
                (
                    user_id,
                    reel_id
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
                    "Reel saved",
            });

        } catch (error) {
            res.status(400).json({
                message:
                    "Reel already saved",
            });
        }
    }
);

/* =========================================================
   UNSAVE REEL
========================================================= */

app.delete(
    "/reels/:id/save",
    auth,
    async (req, res) => {
        try {

            await run(
                `
                DELETE FROM saved_reels

                WHERE user_id = ?

                AND reel_id = ?
                `,
                [
                    req.user.id,
                    req.params.id,
                ]
            );

            res.json({
                success: true,
                message:
                    "Reel removed from saved",
            });

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to unsave reel",
            });
        }
    }
);

/* =========================================================
   GET SAVED REELS
========================================================= */

app.get(
    "/saved-reels",
    auth,
    async (req, res) => {
        try {

            const reels =
                await all(
                    `
                    SELECT

                        reels.*,

                        users.name,

                        users.photo,

                        saved_reels.created_at
                        AS saved_at

                    FROM saved_reels

                    JOIN reels

                    ON reels.id =
                       saved_reels.reel_id

                    JOIN users

                    ON users.id =
                       reels.user_id

                    WHERE
                        saved_reels.user_id = ?

                    ORDER BY
                        saved_reels.created_at DESC
                    `,
                    [req.user.id]
                );

            res.json(reels);

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to load saved reels",
            });
        }
    }
);

/* =========================================================
   GET LIKED REELS
========================================================= */

app.get(
    "/liked-reels",
    auth,
    async (req, res) => {
        try {

            const reels =
                await all(
                    `
                    SELECT

                        reels.*,

                        users.name,

                        users.photo,

                        reel_likes.created_at
                        AS liked_at

                    FROM reel_likes

                    JOIN reels

                    ON reels.id =
                       reel_likes.reel_id

                    JOIN users

                    ON users.id =
                       reels.user_id

                    WHERE
                        reel_likes.user_id = ?

                    ORDER BY
                        reel_likes.created_at DESC
                    `,
                    [req.user.id]
                );

            res.json(reels);

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to load liked reels",
            });
        }
    }
);

/* =========================================================
   CREATE HIGHLIGHT
========================================================= */

app.post(
    "/highlights",
    auth,
    async (req, res) => {
        try {

            const {
                title,
                cover_image,
            } = req.body;

            if (!title) {
                return res.status(400).json({
                    message:
                        "Highlight title is required",
                });
            }

            const result =
                await run(
                    `
                    INSERT INTO highlights
                    (
                        user_id,
                        title,
                        cover_image
                    )

                    VALUES (?, ?, ?)
                    `,
                    [
                        req.user.id,
                        title,
                        cover_image || "",
                    ]
                );

            res.json({
                success: true,
                id:
                    result.lastID,
                message:
                    "Highlight created",
            });

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to create highlight",
            });
        }
    }
);

/* =========================================================
   GET USER HIGHLIGHTS
========================================================= */

app.get(
    "/users/:id/highlights",
    auth,
    async (req, res) => {
        try {

            const highlights =
                await all(
                    `
                    SELECT *

                    FROM highlights

                    WHERE user_id = ?

                    ORDER BY
                        created_at DESC
                    `,
                    [req.params.id]
                );

            res.json(highlights);

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to load highlights",
            });
        }
    }
);

/* =========================================================
   EDIT HIGHLIGHT
========================================================= */

app.put(
    "/highlights/:id",
    auth,
    async (req, res) => {
        try {

            const {
                title,
                cover_image,
            } = req.body;

            await run(
                `
                UPDATE highlights

                SET

                    title = ?,

                    cover_image = ?

                WHERE id = ?

                AND user_id = ?
                `,
                [
                    title,
                    cover_image || "",
                    req.params.id,
                    req.user.id,
                ]
            );

            res.json({
                success: true,
                message:
                    "Highlight updated",
            });

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to update highlight",
            });
        }
    }
);

/* =========================================================
   DELETE HIGHLIGHT
========================================================= */

app.delete(
    "/highlights/:id",
    auth,
    async (req, res) => {
        try {

            await run(
                `
                DELETE FROM highlights

                WHERE id = ?

                AND user_id = ?
                `,
                [
                    req.params.id,
                    req.user.id,
                ]
            );

            await run(
                `
                DELETE FROM highlight_reels

                WHERE highlight_id = ?
                `,
                [req.params.id]
            );

            res.json({
                success: true,
                message:
                    "Highlight deleted",
            });

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to delete highlight",
            });
        }
    }
);

/* =========================================================
   ADD REEL TO HIGHLIGHT
========================================================= */

app.post(
    "/highlights/:id/reels/:reelId",
    auth,
    async (req, res) => {
        try {

            const highlight =
                await get(
                    `
                    SELECT *

                    FROM highlights

                    WHERE id = ?

                    AND user_id = ?
                    `,
                    [
                        req.params.id,
                        req.user.id,
                    ]
                );

            if (!highlight) {
                return res.status(404).json({
                    message:
                        "Highlight not found",
                });
            }

            await run(
                `
                INSERT INTO highlight_reels
                (
                    highlight_id,
                    reel_id
                )

                VALUES (?, ?)
                `,
                [
                    req.params.id,
                    req.params.reelId,
                ]
            );

            res.json({
                success: true,
                message:
                    "Reel added to highlight",
            });

        } catch (error) {
            res.status(400).json({
                message:
                    "Reel already in highlight",
            });
        }
    }
);

/* =========================================================
   REMOVE REEL FROM HIGHLIGHT
========================================================= */

app.delete(
    "/highlights/:id/reels/:reelId",
    auth,
    async (req, res) => {
        try {

            await run(
                `
                DELETE FROM highlight_reels

                WHERE highlight_id = ?

                AND reel_id = ?
                `,
                [
                    req.params.id,
                    req.params.reelId,
                ]
            );

            res.json({
                success: true,
                message:
                    "Reel removed from highlight",
            });

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to remove reel",
            });
        }
    }
);

/* =========================================================
   GET HIGHLIGHT REELS
========================================================= */

app.get(
    "/highlights/:id/reels",
    auth,
    async (req, res) => {
        try {

            const reels =
                await all(
                    `
                    SELECT
                        reels.*

                    FROM highlight_reels

                    JOIN reels

                    ON reels.id =
                       highlight_reels.reel_id

                    WHERE
                        highlight_reels.highlight_id = ?

                    ORDER BY
                        reels.created_at DESC
                    `,
                    [req.params.id]
                );

            res.json(reels);

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to load highlight reels",
            });
        }
    }
);

/* =========================================================
   TRIP LIKE / UNLIKE TOGGLE
========================================================= */

app.post("/like/:id", auth, async (req, res) => {
    try {

        const userId = req.user.id;
        const tripId = req.params.id;

        // Check whether user already liked this trip
        const existingLike = await get(
            `
            SELECT id
            FROM likes
            WHERE user_id = ?
            AND trip_id = ?
            `,
            [userId, tripId]
        );

        // ================================================
        // ALREADY LIKED → UNLIKE
        // ================================================

        if (existingLike) {

            await run(
                `
                DELETE FROM likes
                WHERE user_id = ?
                AND trip_id = ?
                `,
                [userId, tripId]
            );

            // Get updated count
            const count = await get(
                `
                SELECT COUNT(*) AS count
                FROM likes
                WHERE trip_id = ?
                `,
                [tripId]
            );

            return res.json({
                success: true,
                liked: false,
                count: count.count
            });
        }

        // ================================================
        // NOT LIKED → LIKE
        // ================================================

        await run(
            `
            INSERT INTO likes
            (
                user_id,
                trip_id
            )
            VALUES (?, ?)
            `,
            [userId, tripId]
        );

        // Get trip owner
        const trip = await get(
            `
            SELECT user_id, title
            FROM trips
            WHERE id = ?
            `,
            [tripId]
        );

        // Create notification
        if (
            trip &&
            Number(trip.user_id) !== Number(userId)
        ) {

            await run(
                `
                INSERT INTO notifications
                (
                    user_id,
                    type,
                    title,
                    message
                )
                VALUES (?, ?, ?, ?)
                `,
                [
                    trip.user_id,
                    "like",
                    "❤️ Someone liked your trip!",
                    `Your "${trip.title}" trip received a new like.`
                ]
            );
        }

        // Get updated count
        const count = await get(
            `
            SELECT COUNT(*) AS count
            FROM likes
            WHERE trip_id = ?
            `,
            [tripId]
        );

        return res.json({
            success: true,
            liked: true,
            count: count.count
        });

    } catch (error) {

        console.error("LIKE TOGGLE ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to like/unlike trip"
        });
    }
});


/* =========================================================
   CHECK LIKE
========================================================= */

app.get("/check-like/:id", auth, async (req, res) => {

    try {

        const row = await get(
            `
            SELECT id
            FROM likes
            WHERE user_id = ?
            AND trip_id = ?
            `,
            [
                req.user.id,
                req.params.id
            ]
        );

        res.json({
            liked: !!row
        });

    } catch (error) {

        console.error("CHECK LIKE ERROR:", error);

        res.status(500).json({
            message: "Database error"
        });
    }
});


/* =========================================================
   LIKES COUNT
========================================================= */

app.get("/likes-count/:id", async (req, res) => {

    try {

        const row = await get(
            `
            SELECT COUNT(*) AS count
            FROM likes
            WHERE trip_id = ?
            `,
            [req.params.id]
        );

        res.json({
            count: Number(row.count || 0)
        });

    } catch (error) {

        console.error("LIKES COUNT ERROR:", error);

        res.status(500).json({
            message: "Database error"
        });
    }
});
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

                id:
                    result.lastID,

                message:
                    "Comment added",
            });

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to add comment",
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

                        users.id
                        AS user_id,

                        users.name,

                        users.photo

                    FROM comments

                    JOIN users

                    ON comments.user_id =
                       users.id

                    WHERE
                        comments.trip_id = ?

                    ORDER BY
                        comments.created_at DESC
                    `,
                    [req.params.tripId]
                );

            res.json(rows);

        } catch (error) {
            res.status(500).json({
                message:
                    "Failed to load comments",
            });
        }
    }
);

/* =========================================================
   FACE LOGIN
========================================================= */

/* =========================================================
   FACE LOGIN
========================================================= */

/* =========================================================
   FACE LOGIN
========================================================= */

/* =========================================================
   FACE LOGIN
========================================================= */

/* =========================================================
   FACE LOGIN
========================================================= */

app.post("/face-login", async (req, res) => {
    try {

        console.log("=================================");
        console.log("FACE LOGIN REQUEST");
        console.log("=================================");

        // ==========================================
        // CHECK REQUEST BODY
        // ==========================================

        console.log("Request body:", req.body);
        console.log(
            "Content-Type:",
            req.headers["content-type"]
        );

        if (
            !req.body ||
            typeof req.body !== "object"
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Request body is missing or invalid"
            });
        }

        // ==========================================
        // GET DATA FROM REQUEST
        // ==========================================

        const browserId =
            req.body.browserId;

        const faceDescriptor =
            req.body.faceDescriptor;

        console.log(
            "Browser ID:",
            browserId
        );

        console.log(
            "Face descriptor exists:",
            !!faceDescriptor
        );

        console.log(
            "Face descriptor type:",
            typeof faceDescriptor
        );

        // ==========================================
        // CHECK BROWSER ID
        // ==========================================

        if (!browserId) {
            return res.status(400).json({
                success: false,
                message:
                    "Browser ID is required"
            });
        }

        // ==========================================
        // CHECK FACE DESCRIPTOR
        // ==========================================

        if (!faceDescriptor) {
            return res.status(400).json({
                success: false,
                message:
                    "Face descriptor is required"
            });
        }

        // ==========================================
        // CONVERT CURRENT FACE
        // ==========================================

        let currentFace;

        try {

            currentFace =
                Array.from(faceDescriptor);

        } catch (error) {

            console.error(
                "CURRENT FACE CONVERSION ERROR:",
                error
            );

            return res.status(400).json({
                success: false,
                message:
                    "Invalid current face data"
            });
        }

        // ==========================================
        // CHECK CURRENT FACE
        // ==========================================

        if (!Array.isArray(currentFace)) {
            return res.status(400).json({
                success: false,
                message:
                    "Invalid face descriptor"
            });
        }

        console.log(
            "Current face length:",
            currentFace.length
        );

        // ==========================================
        // FACE DESCRIPTOR MUST HAVE 128 VALUES
        // ==========================================

        if (currentFace.length !== 128) {
            return res.status(400).json({
                success: false,
                message:
                    "Face descriptor must contain 128 values"
            });
        }

        // ==========================================
        // FIND USER USING BROWSER ID
        // ==========================================

        const user = await get(
            `
            SELECT
                id,
                name,
                email,
                face_browser_id,
                face_descriptor
            FROM users
            WHERE face_browser_id = ?
            LIMIT 1
            `,
            [browserId]
        );

        console.log(
            "USER FOUND:",
            user
        );

        // ==========================================
        // USER NOT FOUND
        // ==========================================

        if (!user) {
            return res.status(401).json({
                success: false,
                message:
                    "Face authentication not registered on this browser"
            });
        }

        // ==========================================
        // CHECK SAVED FACE
        // ==========================================

        if (!user.face_descriptor) {
            return res.status(401).json({
                success: false,
                message:
                    "Face authentication is not registered"
            });
        }

        // ==========================================
        // CONVERT SAVED FACE
        // ==========================================

        let savedFace;

        try {

            if (
                typeof user.face_descriptor ===
                "string"
            ) {

                savedFace =
                    JSON.parse(
                        user.face_descriptor
                    );

            } else {

                savedFace =
                    Array.from(
                        user.face_descriptor
                    );
            }

        } catch (error) {

            console.error(
                "SAVED FACE JSON ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Saved face data is corrupted"
            });
        }

        // ==========================================
        // CHECK SAVED FACE ARRAY
        // ==========================================

        if (!Array.isArray(savedFace)) {

            console.log(
                "Saved face:",
                savedFace
            );

            return res.status(500).json({
                success: false,
                message:
                    "Saved face data is invalid"
            });
        }

        console.log(
            "Saved face length:",
            savedFace.length
        );

        // ==========================================
        // SAVED FACE MUST HAVE 128 VALUES
        // ==========================================

        if (savedFace.length !== 128) {
            return res.status(500).json({
                success: false,
                message:
                    "Saved face descriptor must contain 128 values"
            });
        }

        // ==========================================
        // CALCULATE FACE DISTANCE
        // ==========================================

        let sum = 0;

        for (
            let i = 0;
            i < 128;
            i++
        ) {

            const savedValue =
                Number(savedFace[i]);

            const currentValue =
                Number(currentFace[i]);

            // ==========================================
            // CHECK VALUES
            // ==========================================

            if (
                !Number.isFinite(savedValue) ||
                !Number.isFinite(currentValue)
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid face descriptor values"
                });
            }

            // ==========================================
            // FIND DIFFERENCE
            // ==========================================

            const difference =
                savedValue -
                currentValue;

            // ==========================================
            // SQUARE DIFFERENCE
            // ==========================================

            sum +=
                difference *
                difference;
        }

        // ==========================================
        // FINAL FACE DISTANCE
        // ==========================================

        const distance =
            Math.sqrt(sum);

        console.log(
            "FACE DISTANCE:",
            distance
        );

        // ==========================================
        // FACE MATCH THRESHOLD
        // ==========================================

        const FACE_THRESHOLD = 0.6;

        console.log(
            "FACE THRESHOLD:",
            FACE_THRESHOLD
        );

        // ==========================================
        // FACE DOES NOT MATCH
        // ==========================================

        if (
            distance >
            FACE_THRESHOLD
        ) {

            console.log(
                "❌ FACE DOES NOT MATCH"
            );

            return res.status(401).json({
                success: false,
                message:
                    "Face does not match"
            });
        }

        // ==========================================
        // CREATE JWT TOKEN
        // ==========================================

        const token = jwt.sign(
            {
                id: user.id
            },
            SECRET,
            {
                expiresIn: "7d"
            }
        );

        // ==========================================
        // SET AUTH COOKIE
        // ==========================================

        setAuthCookies(
            res,
            token
        );

        // ==========================================
        // SUCCESS
        // ==========================================

        console.log(
            "✅ FACE LOGIN SUCCESS"
        );

        return res.status(200).json({
            success: true,
            userId: user.id,
            name: user.name,
            email: user.email,
            message:
                "Face login successful"
        });

    } catch (error) {

        // ==========================================
        // FACE LOGIN ERROR
        // ==========================================

        console.error(
            "================================="
        );

        console.error(
            "❌ FACE LOGIN ERROR"
        );

        console.error(
            "ERROR MESSAGE:",
            error.message
        );

        console.error(
            "ERROR STACK:",
            error.stack
        );

        console.error(
            "================================="
        );

        return res.status(500).json({
            success: false,
            message:
                "Face login failed",
            error:
                error.message
        });
    }
});


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
   GET NOTIFICATIONS
========================================================= */

app.get(
    "/notifications",
    auth,
    async (req, res) => {
        try {

            const notifications = await all(
                `
                SELECT
                    id,
                    type,
                    title,
                    message,
                    is_read,
                    created_at

                FROM notifications

                WHERE user_id = ?

                ORDER BY created_at DESC
                `,
                [req.user.id]
            );

            res.json({
                success: true,
                notifications
            });

        } catch (error) {

            console.error(
                "GET NOTIFICATIONS ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Failed to load notifications"
            });
        }
    }
);
/* =========================================================
   START SERVER
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
                    `🌍 Environment: ${process.env.NODE_ENV ||
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