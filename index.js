// mandatory setup.js
const fs = require("fs");
const path = require("path");
const nunjucks = require("nunjucks");
if (!fs.existsSync(path.normalize(__dirname + "/setup.js"))) {
    throw "You need to create a setup.js file. Refer to the readme.";
}

const setup = require("./setup.js");
const log = require("./logger.js")(module);
const database = require("./dbHandler.js");

// Apparently JS has a shit fit when it can't throw errors properly so uh, we need to make it throw errors properly
process.on("uncaughtException", function (exception) {
    console.log(exception);
});

database.connect(function () {
    const db = database.db;
    const express = require("express");
    const passport = require("passport");
    const app = express();
    const OAuth2Strategy = require("passport-oauth2");
    const refresh = require("passport-oauth2-refresh");
    const bodyParser = require("body-parser");
    const request = require("request");
    const url = require("url");
    const session = require("express-session");
    const mongoStore = require("connect-mongo")(session);

    // Custom imports

    const users = require("./users.js")(setup);
    const customSSO = require("./customSSO.js")(refresh, setup, request, url);
    const fleets = require("./fleets.js")(setup);

    // Start timers
    fleets.timers();

    // Configure Passport's oAuth
    var oauthStrategy = new OAuth2Strategy({
        authorizationURL: `https://${setup.oauth.baseSSOUrl}/oauth/authorize`,
        tokenURL: `https://${setup.oauth.baseSSOUrl}/oauth/token`,
        clientID: setup.oauth.clientID,
        clientSecret: setup.oauth.secretKey,
        callbackURL: setup.oauth.callbackURL
    },
    function (accessToken, refreshToken, profile, done) {
        // Our user has logged in, let's get a unique ID for them (Their character ID, because why not)
        customSSO.verifyReturnCharacterDetails(refreshToken, function (success, response, characterDetails) {
            if (success) {
                users.findOrCreateUser(users, refreshToken, characterDetails, function (user, err) {
                    if (user === false) {
                        done(err);
                    } else {
                        done(null, user);
                    }
                });
            } else {
                log.info(`Character ID request failed for token ${refreshToken}`);
                done(success);
            }
        });
    });

    passport.serializeUser(function (user, done) {
        done(null, user);
    });

    passport.deserializeUser(function (user, done) {
        done(null, user);
    });

    // Extend some stuff
    passport.use("provider", oauthStrategy);
    refresh.use("provider", oauthStrategy);
    app.use(session({
        store: new mongoStore({db: database.db}),
        secret: setup.data.sessionSecret,
        cookie: {maxAge: 604800 * 1000}, // Week long cookies for week long incursions!
        resave: true,
        saveUninitialized: true
    }));
    app.use(passport.initialize());
    app.use(passport.session());
    app.use(bodyParser.urlencoded({extended: true}));
    app.use("/includes", express.static("public/includes"));
    app.use(users.updateUserSession); // Force the session to update from DB on every page load because sessions are not the source of truth here!

    nunjucks.configure("views", {
        autoescape: true,
        express: app
    });

    // Routes
    require("./oAuthRoutes.js")(app, passport, setup);
    var routeListen = require("./routes.js");
    app.use(routeListen);

    // Configure Express webserver
    app.listen(setup.settings.port, function listening () {
        log.info("Express online and accepting connections");
    });
});
