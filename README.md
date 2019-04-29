# node-jkasteambot

## Installing

The bot runs on NodeJS 6+. NPM is used to automatically download and install dependencies.

On Linux :

```shell
sudo apt-get install nodejs npm
```

You can check your NodeJS version with :

```shell
node -v
```

Then, download dependencies with :

```shell
npm install
```

## Configuring

### config.json

Rename `config.default.json` to `config.json` (or make a copy and name it that way). Several settings can be changed :

* `dataFolder`: This must point to a folder where the user running the bot has writing access. Temporary files such as Steam sentry files will be stored there. This is also the folder where levelshots will be read from and uploaded as Steam avatars.
* `unsafeCmdsOnlyCLI`: If set to true, critical commands can only be used from the command line interface (recommended).
* `steam`: Steam specific information.
    * `username`: Bot account username.
    * `password`: Bot account password.
    * `nickname`: Base name that will be used for the bot.
    * `admins`: Array of SteamID64 who are granted admin permissions. You can easily get these IDs from websites such as https://steamid.io.
    * `autoconnect`: If set to true, automatically connect to Steam upon starting the bot (recommended).
* `server`: JKA server specific information.
    * `address`: IP address of the queried server.
    * `port`: Server port.
    * `interval`: Delay between two consecutive server queries, in milliseconds.
    
### Steam avatars

The bot automatically uploads the levelshot of the current map as its Steam avatar.

By default, or if the server is offline/no picture is found, the image `default_avatar.jpg` is used. You should change this to the picture you want your bot to have by default.

Map levelshots are read from `<data folder>/levelshots/`. The bot follows the same folder hierarchy as JKA would. For instance, `mp/ctf_kejim` will be read from `<data folder>/levelshots/mp/ctf_kejim.jpg`.

All pictures must be in the JPG format. While Steam automatically resizes uploaded pictures, it is recommended to keep them to the size of 184x184 pixels (maximum Steam avatar size) to save bandwidth.

A script is provided to automatically extract, convert and resize all levelshots from PK3s. You can use it directly on your server's base folder to quickly get the bot running :

```shell
extract_levelshots.sh -i <my server folder>/base -o <data folder>/levelshots
```

## Running

Once you have fully configured the bot, you can run it using :

```shell
node jkasteambot.js run
```

A SteamGuard code will be asked if the bot requires it.

You can type `help` in the console to see all available commands, including those that can only be used from CLI. All commands work exactly as if they were typed as chat messages to the bot.

The bot will automatically reconnect to Steam if the connection is lost. However, if more critical errors happen, you should check on the process and restart it manually.
