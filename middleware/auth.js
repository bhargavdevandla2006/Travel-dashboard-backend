const jwt = require("jsonwebtoken");
const SECRET = "travel_secret_key";

function auth(req, res, next){
    const token = req.cookies.token

    if(!token){
        return res.status(401).json({
            message:"Please Login First"
        });
    }
    try{
         const decode =  jwt.verify(token, SECRET);
         req.user = decode
         next();
    }catch(error){
         return res.status(401).json({
            message:"Invalid token"
         })
    }
}   
module.exports = auth;