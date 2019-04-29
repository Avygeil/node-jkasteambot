#!/usr/bin/env node

'use strict';

// JKA Steam Bot

// dependencies
let fs = require('fs');
let jkutils = require( 'jkutils' );
let SteamUser = require( 'steam-user' );
let SteamCommunity = require( 'steamcommunity' );

// constants
const configFilePath = './config.json';

// local configuration
let config = require( configFilePath );

// script entry point handlers
let handlers = {
    'run': () => {
        /** initial setup  **/

        let client = new SteamUser();
        let community = new SteamCommunity;

        client.setOption( 'dataDirectory', config.dataFolder );
        client.setOption( 'autoRelogin', true );
        client.setOption( 'singleSentryfile', false );
        client.setOption( 'promptSteamGuardCode', false );

        let loginDetails = {
            accountName: config.steam.username,
            password: config.steam.password
        };

        // some values that will be set later

        let reconnectTimeout = null; // non null if we got a login error and we are going to try to reconnect soon
        let canSendFriendRequests = false; // assume false until the accountLimitations event is triggered
        let communityLoggedIn = false; // needed because steamcommunity connections can expire independently
        let serverOfflineTimeout = null; // timeout until we consider server offline, reset every response
        let serverOffline = true; // indicates whether or not query data is valid, set by serverOfflineTimeout
        let lastUploadedAvatar = ""; // map name of the last uploaded avatar (:default: for default avatar)

        /** getstatus interval setup **/

        // server status updated by the bot
        let serverstatus = {
            maxClients: 0, // sv_maxclients
            maxNormalClients: 0, // sv_maxclients - sv_privateclients
            maxPrivateClients: 0, // sv_privateclients
            humanPlayers: 0, // clients - bots
            //privatePlayers: null, TODO: add for servers that support this
            map: '', // mapname
            playerList: [] // list of player objects
        }

        // this interval queries and updates its associated server's status
        // independently from the connection to Steam servers, and is only
        // cleared in the 'quit' command
        // this means that the bot can be run independently in CLI without
        // a Steam account, for instance for testing purposes
        let getstatusInterval = null;

        // sane interval value: 1000ms minimum
        if ( config.server.interval < 1000 ) {
            config.server.interval = 1000;
        }

        // handles renaming both with/without serverstatus
        function updateStatus() {
            if ( !client.steamID ) {
                return; // don't rename if we aren't logged in
            }

            let name = config.steam.nickname;

            if ( !serverOffline ) {
                // do a formatted name based on status
                name += ' [' + serverstatus.humanPlayers + '/' + serverstatus.maxNormalClients;
                if ( serverstatus.maxPrivateClients > 0 ) name += '+' + serverstatus.maxPrivateClients;
                name += ']';
            }

            client.setPersona( SteamUser.EPersonaState.Online, name );

            // our steamcommunity http session may expire at times, so just skip
            // the profile picture change until we are logged back in
            if ( community.steamID && communityLoggedIn ) {
                let avatarToUpload = ":default:";

                // only use the query response map if the file exists
                if ( !serverOffline && serverstatus.map && fs.existsSync( config.dataFolder + '/levelshots/' + serverstatus.map + '.jpg' ) ) {
                    avatarToUpload = serverstatus.map;
                }

                // only upload it if it's different
                if ( avatarToUpload !== lastUploadedAvatar ) {
                    lastUploadedAvatar = avatarToUpload;

                    // convert it to a path
                    if ( avatarToUpload === ":default:" ) {
                        avatarToUpload = "./default_avatar.jpg"; // hardcode default avatar

                        // the default avatar may not exist, so check for it here
                        if ( !fs.existsSync( avatarToUpload ) ) {
                            avatarToUpload = "";
                        }
                    } else {
                        // use the path that we checked before
                        avatarToUpload = config.dataFolder + '/levelshots/' + serverstatus.map + '.jpg';
                    }

                    if ( avatarToUpload ) {
                        console.log( 'Uploading avatar from ' + avatarToUpload );

                        community.uploadAvatar( avatarToUpload, ( err, url ) => {
                            if ( err ) console.log( "ERROR while uploading avatar: " + err );
                            console.log( 'Changed avatar successfully to ' + url );
                        } );
                    }
                }
            }
        }

        // only start the interval if the address config field isn't empty
        // (which is the default value)
        // the bot can run and connect to Steam without it, but the status
        // will never be updated and a warning will be printed
        if ( config.server.address ) {
            console.log( 'Querying ' + config.server.address + ':' + config.server.port + ' every ' + config.server.interval + 'ms' );

            getstatusInterval = setInterval( () => {
                jkutils.createSocket(
                    ( err, socket ) => {
                        if ( err ) {
                            return console.log( 'ERROR when creating socket: ' + err );
                        }

                        let timeoutResponse = null;

                        if ( !socket ) {
                            return console.log( 'WARNING: no response from ' + config.server.address + ':' + config.server.port );
                        } else {
                            timeoutResponse = setTimeout( () => {
                                if ( !socket ) {
                                    return; // this has already been done, the timeout is useless
                                }

                                console.log( 'WARNING: query to ' + config.server.address + ':' + config.server.port + ' timed out' );

                                socket.close();
                                socket = null;
                            }, 5000 );
                        }

                        let getstatusParams = {
                            ip: config.server.address,
                            port: config.server.port,
                            challenge: 'jkasteambot-query'
                        }

                        socket.sendServerCommand.getstatus( getstatusParams, ( err ) => {
                            if ( err ) {
                                return console.log( 'ERROR while sending getstatus: ' + err );
                            }
                        } );

                        socket.on( 'statusResponse', ( info, clients, ip, port ) => {
                                // we got a response, clear the timeout
                                if ( timeoutResponse ) {
                                    clearTimeout( timeoutResponse );
                                    timeoutResponse = null;
                                }

                                // clear the stored player list array
                                serverstatus.playerList.length = 0;

                                // convert array of 'Score Ping "Name"' to an array of named objects
                                clients.forEach( ( combinedLine ) => {
                                    let tokens = combinedLine.trim().split( '"' ).filter( s => s ) || [];

                                    // tokens should now be 'Score Ping ' and 'Name'
                                    if ( tokens.length == 2 ) {
                                        let playerName = tokens[1];
                                        tokens = tokens[0].trim().split( ' ' ).filter( s => s ) || [];

                                        // tokens should now be 'Score' and 'Ping'
                                        if ( tokens.length == 2 ) {
                                            serverstatus.playerList.push( {
                                                name: jkutils.stripColours( playerName ),
                                                score: parseInt( tokens[0], 10 ) || 0,
                                                ping: parseInt( tokens[1], 10 ) || 0
                                            } );
                                        }
                                    }
                                } );

                                // calculate client count minus bots
                                let humanPlayerCount = 0;
                                serverstatus.playerList.forEach( ( player ) => {
                                    if ( player.ping > 0 ) ++humanPlayerCount;
                                } );

                                // before saving the info values, check what changed
                                // TODO
                                /*let playerCountChanged = humanPlayerCount != serverstatus.humanPlayers;
                                let mapChanged = info.mapname != serverstatus.map;*/

                                // save new info values
                                serverstatus.maxClients = info.sv_maxclients || 0;
                                serverstatus.maxNormalClients = ( info.sv_maxclients - info.sv_privateclients ) || 0;
                                serverstatus.maxPrivateClients = info.sv_privateclients || 0;
                                serverstatus.humanPlayers = humanPlayerCount;
                                serverstatus.map = info.mapname || '';

                                /*if ( playerCountChanged ) {
                                    TODO: notifications
                                }*/

                                /*if ( mapChanged ) {
                                    TODO: map profile icon
                                }*/

                                // ideally, we should only trigger this if one of the values
                                // used in the name format changed ; however, sometimes Steam
                                // can randomly ignore rename requests, so just do it every time
                                // (it's not expensive anyway)
                                updateStatus();

                                // we just got valid server data, so reset the offline timeout

                                if ( serverOfflineTimeout ) {
                                    clearTimeout( serverOfflineTimeout );
                                }

                                serverOffline = false;

                                // server is considered offline after 120 seconds
                                serverOfflineTimeout = setTimeout( () => {
                                    serverOffline = true;
                                }, 120000 );

                                // we're done, close the socket
                                socket.close();
                                socket = null;
                            }
                        );
                    }
                );
            }, config.server.interval );
        } else {
            console.log( 'WARNING: Address config field is empty! Server status will not be updated' );
        }

        /** bot commands, shared by cli/chat interfaces **/

        // 'requiresAdmin' and 'unsafe' are optional properties that default to 'false'
        let commands = {
            'help': {
                description: 'Shows this message',
                func: ( ctx, echoCallback ) => {
                    let commandHelpArr = [];

                    // make a temporary array of command names/descriptions based on permission
                    Object.keys( commands ).forEach( ( key ) => {
                        let cmd = commands[key];

                        // only print commands usable by this user in this environment
                        if ( ( !cmd.requiresAdmin || ctx.isAdmin ) && ( !config.unsafeCmdsOnlyCLI || !cmd.unsafe || ctx.fromCLI ) ) {
                            // only prefix with the optional '!' if not from cli
                            commandHelpArr.push( ( !ctx.fromCLI ? '!' : '' ) + key + ': ' + cmd.description );
                        }
                    } );

                    echoCallback( 'Available commands:\n  * ' + commandHelpArr.join( '\n  * ' ) );
                }
            },
            'connect': {
                description: 'Connects the bot to the Steam network',
                requiresAdmin: true,
                unsafe: true,
                func: ( ctx, echoCallback ) => {
                    if ( !config.steam.username || !config.steam.password ) {
                        return console.log( "You can't connect if no username/password is specified in config" );
                    }

                    if ( client.steamID ) {
                        return console.log( 'Already connected to the Steam network!' );
                    }

                    // we might have a pending reconnect timeout, so cancel it since
                    // if this fails, another one will be started
                    if ( reconnectTimeout ) {
                        clearTimeout( reconnectTimeout );
                        reconnectTimeout = null;
                    }

                    client.logOn( loginDetails );
                }
            },
            'disconnect': {
                description: 'Disconnects the bot from the Steam network',
                requiresAdmin: true,
                unsafe: true,
                func: ( ctx, echoCallback ) => {
                    if ( !client.steamID ) {
                        return console.log( 'Not connected to the Steam network!' );
                    }

                    client.logOff(); // won't trigger an auto relogin
                }
            },
            'quit': {
                description: 'Shutdowns the bot',
                requiresAdmin: true,
                unsafe: true,
                func: ( ctx, echoCallback ) => {
                    // stop the getstatus interval if it was started
                    if ( getstatusInterval ) {
                        clearInterval( getstatusInterval );
                        getstatusInterval = null;
                    }

                    // stop the offline timeout
                    if ( serverOfflineTimeout ) {
                        clearTimeout( serverOfflineTimeout );
                        serverOfflineTimeout = null;
                    }

                    // cancel current reconnect attempt if there is one
                    if ( reconnectTimeout ) {
                        clearTimeout( reconnectTimeout );
                        reconnectTimeout = null;
                    }

                    if ( client.steamID ) {
                        client.logOff(); // won't trigger an auto relogin
                    }

                    process.stdin.end(); // this is needed, otherwise it must be closed with CTRL D
                }
            },
            'status': {
                description: 'Gives the status of the JKA server queried by this bot',
                func: ( ctx, echoCallback ) => {
                    if ( serverOffline ) {
                        return echoCallback( 'The server is offline' );
                    }

                    let response = "Map: " + serverstatus.map + '\n\n';

                    if ( serverstatus.playerList.length > 0 ) {
                        response += "ping:\tscore:\tname:";

                        // I know this looks weird, but it's necessary for steam chat formatting
                        // Tabs are displayed perfectly fine in CLI in any case
                        // Steam is able to display them, but it depends on the length of the text
                        // before the tab (which kinda defeats its purpose, but it's the only way
                        // to make it look aligned, and it's necessary because of non fixed width
                        // font). I'm sure it's possible to make something generic that works in any
                        // case, but I haven't bothered learning more about how Steam handles this.
                        // These spaces work perfectly fine for 1 to 3 digits ping and 1 to 4 digits
                        // score, and for all combinations. Not sure if it breaks with more...
                        let psSep = ctx.fromCLI ? '\t' : '    \t'; // ping/score separator
                        let snSep = ctx.fromCLI ? '\t' : '       \t'; // score/name separator

                        serverstatus.playerList.forEach( ( player ) => {
                            response += '\n' + ( player.ping > 0 ? player.ping : 'BOT' ) + psSep + player.score + snSep + player.name;
                        } );
                    } else {
                        response += "Server is empty."
                    }

                    echoCallback( response );
                }
            },
            'addfriend': {
                description: 'Sends a friend invite to the specified user (requires a non limited Steam account)',
                requiresAdmin: true,
                func: ( ctx, echoCallback ) => {
                    if ( !client.steamID ) {
                        return echoCallback( "You must be logged into Steam to use this command" );
                    }

                    if ( !canSendFriendRequests ) {
                        return echoCallback( "This Steam account cannot send friend requests" );
                    }

                    if ( ctx.args.length < 1 ) {
                        return echoCallback( "Please specify a Steam64 ID" );
                    }

                    let steamid = ctx.args[0];

                    if ( !steamid.match("^[0-9]{17}$") ) {
                        return echoCallback( "Invalid Steam64 ID format, try https://steamid.io" );
                    }

                    if ( client.myFriends[steamid] == SteamUser.EFriendRelationship.Friend ) {
                        return echoCallback( "We are already friends with this user!" );
                    }

                    client.addFriend( steamid );
                    echoCallback( "Sent friend request to [" + steamid + "]" );
                }
            },
            'removefriend': {
                description: 'Removes a friend',
                requiresAdmin: true,
                func: ( ctx, echoCallback ) => {
                    if ( !client.steamID ) {
                        return echoCallback( "You must be logged into Steam to use this command" );
                    }

                    if ( ctx.args.length < 1 ) {
                        return echoCallback( "Please specify a Steam64 ID" );
                    }

                    let steamid = ctx.args[0];

                    if ( !steamid.match("^[0-9]{17}$") ) {
                        return echoCallback( "Invalid Steam64 ID format, try https://steamid.io" );
                    }

                    if ( client.myFriends[steamid] != SteamUser.EFriendRelationship.Friend ) {
                        return echoCallback( "We are not friends with this user!" );
                    }

                    client.removeFriend( steamid );
                    echoCallback( "Removed [" + steamid + "] from friend list" );
                }
            }
        };

        // tokenizes a command string, handles permissions and incorrect usage prints
        // '!' is an optional prefix that was kept because people were used to it
        function handleCommandString( str, senderSteamID, echoCallback ) {
            let tokens = str.trim().split( ' ' ).filter( s => s ) || [];

            if ( tokens.length == 0 ) {
                return;
            }

            // the '!' prefix is optional, cut it if it is present
            if ( tokens[0].charAt( 0 ) === '!' ) {
                tokens[0] = tokens[0].substr( 1 );
            }

            if ( !tokens[0] ) {
                return;
            }

            let cmdContext = {
                name: tokens[0],
                args: tokens.slice( 1 ) || [],
                fromCLI: !senderSteamID, // empty sender id if sent from cli
                isAdmin: !senderSteamID || config.steam.admins.indexOf( senderSteamID.getSteamID64() ) > -1 // if from cli or in the config
            }

            let command = commands[cmdContext.name.toLowerCase()]; // case insensitive lookup

            if ( !command ) {
                // only show '!help' with the optional '!' if not from cli
                return echoCallback( "Invalid command, type '" + ( !cmdContext.fromCLI ? '!' : '' ) + "help' to list available commands" );
            }

            if ( command.requiresAdmin && !cmdContext.isAdmin ) {
                return echoCallback( "You don't have permission to use this command" );
            }

            // if unsafe is true, requiresAdmin should also be true, so the check
            // before has already run to send a better response to non admins
            if ( config.unsafeCmdsOnlyCLI && command.unsafe && !cmdContext.fromCLI ) {
                return echoCallback( "This command cannot be used here" );
            }

        	command.func( cmdContext, echoCallback );
        }

        /** setup stdin callback for CLI **/

        // when this is not null, we are waiting for a Steam Guard code
        let steamGuardCallback = null;

        process.stdin.on( 'data', ( cmd ) => {
            let cmdString = cmd.toString( 'ascii' ).trim();

            if ( !cmdString ) {
                return;
            }

            if ( steamGuardCallback ) {
                // interpret as a Steam Guard code
                steamGuardCallback( cmdString );
                steamGuardCallback = null;
            } else {
                // interpret as a command
                handleCommandString( cmdString, '', ( msg ) => {
                    console.log( msg );
                } );
            }
        } );

        /** Steam connection **/

        client.on( 'loggedOn', ( details, parental ) => {
            // cancel current reconnect attempt if there is one
            if ( reconnectTimeout ) {
                clearTimeout( reconnectTimeout );
                reconnectTimeout = null;
            }

            console.log( 'Logged in successfully to the Steam network as [' + client.steamID + ']' );
            console.log( 'Public IP: ' + client.publicIP + ' / Steam Cell ID: ' + client.cellID );
            updateStatus();
        } );

        client.on( 'error', ( err ) => {
            // an error occured during logon or we got a fatal disconnect
            console.log( 'ERROR: Fatal error during login (' + SteamUser.EResult[err.eresult] + ')' );

            // usually, we won't be able to reconnect after this, but in some
            // cases it will work again after a while
            // we could exit the process and return an error, but the point is
            // that the bot should always stay online, and most of the time this
            // error will require someone to check the process anyway
            // so instead, try to reconnect in 10 minutes
            console.log( "Unless you reconnect manually, the bot will attempt to do it in 10 minutes" );
            reconnectTimeout = setTimeout( () => {
                console.log( "Attempting to reconnect..." );
                client.logOn( loginDetails );
            }, 1000 * 60 * 10 ); // 10 mins
        } );

        client.on( 'disconnected', ( eresult, msg ) => {
            // disconnecting for a non-fatal reason
            console.log( 'Disconnected from the Steam network' + ( eresult ? ( ' (' + SteamUser.EResult[eresult] + ( msg ? ( ': ' + msg ) : '' ) + ')' ) : '' ) );

            client.steamID = null; // apparently this isn't set

            // unless we disconnected on purpose using a command, the
            // steam-user module will continually try to reconnect until
            // loggedOn or error is emitted, so we don't need to do it
        } );

        client.on( 'steamGuard', ( domain, callback, lastCodeWrong ) => {
            if ( domain ) {
                // e-mail code
                console.log( 'Steam Guard code needed from e-mail: ******@' + domain );
            } else {
                // app code
                console.log( 'Steam Guard code needed from app' + ( lastCodeWrong ? ' (last code wrong)' : '' ) )
            }

            console.log( 'Please enter your Steam Guard code:' );

            // will be called in stdin callback
            steamGuardCallback = callback;
        } );

        client.on( 'accountLimitations', ( limited, communityBanned, locked, canInviteFriends ) => {
            if ( limited || !canInviteFriends ) {
                console.log( 'WARNING: This bot account is limited and cannot send friend requests!' );
                console.log( 'The bot will still function properly, and is able to receive requests' );
            } else {
                canSendFriendRequests = true;
            }

            if ( communityBanned ) {
                console.log( 'WARNING: This bot account is banned from Steam Community!' );
            }

            if ( locked ) {
                console.log( 'WARNING: This bot account is locked!' );
            }
        } );

        // only triggered for direct chat messages
        client.on( 'friendMessage', ( senderID, message ) => {
            if ( senderID && message ) {
                console.log( 'Received Steam message from ' + client.users[senderID].player_name + ' [' + senderID + ']: ' + message );

                // execute the command and send the result back as a chat message
                handleCommandString( message, senderID, ( msg ) => {
                    // if this message spans on multiple lines, break on the first line
                    // because it looks better in Steam messages
                    // unfortunately, Steam seems to have updated and it now trims line
                    // breaks in the beginning, so add a dot before it I guess...
                    if ( msg.indexOf( '\n' ) > -1 ) {
                        msg = '.\n' + msg;
                    }

                    client.chatMessage( senderID, msg );
                } );
            }
        } );

        client.on( 'friendsList', () => {
            let numFriends = 0;

            Object.keys( client.myFriends ).forEach( ( steamid ) => {
                // accept offline friend requests
                if ( client.myFriends[steamid] == SteamUser.EFriendRelationship.RequestRecipient ) {
                    console.log( 'Accepting offline friend request from [' + steamid + ']' );
                    client.addFriend( steamid );
                }

                ++numFriends;
            } );

            console.log( 'Friends: ' + numFriends );

            // TODO: autodetect limit based on level? autoremove old friends?
            if ( numFriends > 200 ) {
                console.log( 'WARNING: approaching friend limit' );
            }
        } );

        client.on( 'friendRelationship', ( sid, relationship ) => {
            // friend request while we are online
            if ( relationship == SteamUser.EFriendRelationship.RequestRecipient ) {
                console.log( 'Accepting friend request from [' + sid + ']' );
                client.addFriend( sid );
            }
        } );

        client.on( 'webSession', ( sessionID, cookies ) => {
            // called when logged in to steamcommunity.com (automatically at
            // startup or explicitly with webLogOn())
            console.log( 'Logged in successfully to steamcommunity.com' );

            // resume steamcommunity HTTP connection using this session cookie
            community.setCookies( cookies );
            communityLoggedIn = true;
        } );

        community.on( 'sessionExpired', ( err ) => {
            // this event is emitted as long as we make HTTP requests and our
            // session expired, so it can potentially be called a lot
            // thus, we limit relogins to avoid being rate limited
            if ( communityLoggedIn ) {
                console.log( 'Relogging to steamcommunity.com due to expired session cookies...' );
                client.webLogOn();
                communityLoggedIn = false;
            }
        } );

        if ( !config.steam.username || !config.steam.password ) {
            console.log( "WARNING: Not logging in to the Steam Network due to no username/password specified in config" );
        } else if ( !config.steam.autoconnect ) {
            console.log( "Autoconnect is disabled, use 'connect' to do it manually" );
        } else {
            client.logOn( loginDetails );
        }
    }
};

if ( !module.parent ) {
	console.log( 'Running jkasteambot from CLI' );

	// cut off the process and script name
	let args = process.argv.slice( 2 );

	let handlerFunc = handlers[args[0]];
	if ( handlerFunc ) {
		return handlerFunc( args.slice(1) );
	}

	console.log( 'Please specify a command:\n  ' + Object.keys( handlers ).join( '\n  ' ) );
}
