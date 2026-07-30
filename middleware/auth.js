const jwt = require("jsonwebtoken");
const SECRET = "travel_secret_key";


function auth(req, res, next) {

    console.log("Cookies:", req.cookies);

    const token = req.cookies.token || req.cookies.dev_token;

    console.log("Token:", token);

    if (!token) {
        return res.status(401).json({
            message: "Please Login First"
        });
    }

    try {
        const decode = jwt.verify(token, SECRET);
        req.user = decode;
        next();
    } catch (error) {
        return res.status(401).json({
            message: "Invalid token"
        });
    }
}

function auth(req, res, next){
    const token = req.cookies.token

    if(!token){
        return res.status(401).json({
            message:"Please Login First"
        });
    }
    try{
         const decode =  jwt.verify(token, SECRET);
         // dev debug logs
         if (process.env.NODE_ENV !== "production") {
             console.log('auth token present, decoded id=', decode.id);
         }
         req.user = decode
         next();
    }catch(error){
        if (process.env.NODE_ENV !== "production") {
            console.error('auth verify error', error.message)
        }
         return res.status(401).json({
            message:"Invalid token"
         })
    }
}   
module.exports = auth;