// Import required modules
const express = require('express');
const session = require('express-session');
let FileStore = require('session-file-store')(session);

const fs = require("fs")
const child_process = require('child_process');
const bodyParser = require('body-parser');

const { v4: uuidv4 } = require('uuid');
function makeid(length) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const charactersLength = characters.length;
    let counter = 0;
    while (counter < length) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
      counter += 1;
    }
    return result;
}



const crypto = require('crypto');

function encrypt(text, password) {
    const salt = crypto.randomBytes(16);
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha512');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return salt.toString('hex') + iv.toString('hex') + encrypted + authTag;
}
function decrypt(encryptedText, password) {
    try {
        const salt = Buffer.from(encryptedText.slice(0, 32), 'hex');
        const iv = Buffer.from(encryptedText.slice(32, 64), 'hex');
        const encrypted = encryptedText.slice(64, -32);
        const authTag = Buffer.from(encryptedText.slice(-32), 'hex');
        const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha512');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch(err) { 
        return ""
    }
}



const app = express();
const port = 8080;

app.set('view engine', 'pug');
app.set('views', __dirname + '/views');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
let fileStoreOptions = {};
app.use(session({
    secret: 'cat videos',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
    store: new FileStore(fileStoreOptions)
}));
app.use('/static', express.static('./src/static'))

app.get("/", async (req, res) => {
    if (!req.session.uuid) {
        req.session.uuid = makeid(15);
    }
    req.session.challenge = getCurrentChallenge();
    res.render('solve', {challenge: JSON.stringify(req.session.challenge), userID: JSON.stringify(req.session.uuid)});
})
app.get("/login", async (req, res) => {
    res.render("login")
})


function createUser(username, pass) {
    let newUser = encrypt(username, pass)
    let users = JSON.parse(fs.readFileSync("./data/users.json"))
    users.push(newUser)
    fs.writeFileSync("./data/users.json", JSON.stringify(users))
};
app.post('/login', async (req, res) => {
    // Insert Login Code Here

    let users = JSON.parse(fs.readFileSync("./data/users.json"))
    let found = false;
    users.forEach(user => {
        if (decrypt(user, req.body.password) == req.body.username) {
            found = true;
        }   
    });
    if (!found) {
        req.session.isAdmin = false;
        res.status(401);
        res.send('None shall pass');
        return;
    }
    req.session.isAdmin = true;
    res.status(200);
    res.send('Ok');

});


// Return Types:
// void, boolean, int, double

function getCurrentChallenge() {
    let id = JSON.parse(fs.readFileSync("./data/current.json"))
    return getChallengeFromID(id.current)
}

function getChallengeFromID(uuid) {
    let challenges = JSON.parse(fs.readFileSync("./data/challenges.json"))
    let foundChallenge = null;
    challenges.forEach((challenge) => {
        if (challenge.id == uuid) {
            foundChallenge = challenge;
        }
    })
    return foundChallenge;
}


function genConsoleLog(inside) {
    return `System.out.println(${inside});`
}
function generateFullCode(innerCode, userID, challengeID) {
    let challenge = getChallengeFromID(challengeID)
    
    let argsString = ""
    for (let i = 0; i < challenge.parameters.length; i++) {
        argsString += `${challenge.parameters[i].type} ${challenge.parameters[i].name}`
        if (i + 1 != challenge.parameters.length) {
            argsString += ", "
        }
    }

    let testsString = "";
    let testNum = 0;
    challenge.tests.forEach((test) => {
        let args = "";
        for (let i = 0; i < test.args.length; i++) {
            args += test.args[i]
            if (i + 1 != test.args.length) {
                args += ", "
            }
        }
        if (challenge.returnType == "boolean") {
            testsString += genConsoleLog(`"- ${testNum} " + (${challenge.name}(${args}) ? "true" : "false")`);
        }
        if (challenge.returnType == "double" || challenge.returnType == "int") {
            testsString += genConsoleLog(`"- ${testNum} " + ${challenge.name}(${args})`);
        }
        if (challenge.returnType == "void") {
            testsString += `"- ${testNum} " + ${challenge.name}(${args});`;
        }
        testNum++;
    })


    return `
    class ${userID} {
        public static void main(String[] args) {
            ${testsString}
        }

        public static ${challenge.returnType} ${challenge.name}(${argsString}) {
            ${innerCode}
        };
    } 
    `

}
async function executeJava(javaCode, userID, challengeID) {
    return new Promise((resolve) => {

        fs.writeFileSync("./java/" + userID + ".java", generateFullCode(javaCode, userID, challengeID))

        let process = child_process.exec("cd java/ && javac " + userID + ".java && java " + userID);

        let returnString = ""

        process.stdout.on("data", (data) => {
            returnString += data;
        })
        process.stderr.on("data", (data) => {
            returnString += data;
        })
        process.on("close", (code) => {
            try {fs.unlinkSync("java/" + userID + ".java")} catch(err) { console.log(err) }
            try {fs.unlinkSync("java/" + userID + ".class")} catch(err) { console.log(err) }
            resolve(returnString)
        })
    }) 
}
app.post('/execute', async (req, res) => {
    console.log("Running ", req.body)

    const { javaCode } = req.body;
    const result = await executeJava(javaCode, req.session.uuid, req.session.challenge.id);
    console.log(result)
    res.send(result);
    
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});