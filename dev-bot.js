/******************************
  Variables & Libs
*******************************/

const config = require('./config').production;
const lodash = require('lodash');
const moment = require("moment");
const Discord = require("discord.js");
const client = new Discord.Client();
const { setIntervalAsync } = require('set-interval-async/dynamic');

/******************************
  Bot Auth
*******************************/

const scriptName = __filename.slice(__dirname.length + 1);

if( scriptName == 'dev-bot.js' ) {
  client.login(config.devBotToken);
  console.log("----- DEVELOPMENT BOT -----");
}
else {
  client.login(config.token);
  console.log("----- PRODUCTION BOT -----");
}

const pool = ( scriptName == 'dev-bot.js' ) ? config.getStagingPool() : config.getPool();
const helper = require("./helper.js");
const event = require("./event.js");
const raid_event = new event.Event(client, config);

/******************************
  Event Listeners
*******************************/

client.on("error", (e) => console.error(e));
client.on("warn", (e) => console.warn(e));
// client.on("debug", (e) => console.info(e));

client.on("ready", async function() {

  // Set Bot Status
  client.user.setPresence({ activity: { name: '!event help', type: "PLAYING"}, status: 'online'});

  let statuses = [
    '!event help',
    '!event donate'
  ];

  // Random status message every 5s
  setInterval(function(){
    client.user.setPresence({ activity: { name: statuses[Math.floor(Math.random() * statuses.length)], type: "PLAYING"}, status: 'online'});
  }, 5000);

  // Refresh All Servers
  helper.refreshAllServers(client, raid_event);

  // Reorder All Servers Periodically
  setIntervalAsync(helper.updateGuildChannels, 30000, client, raid_event);
});

client.on("guildCreate", async function(guild) {
  helper.printStatus(`Joined a new guild: ${guild.name}`);
});

/******************************
  Reaction Listener
*******************************/

client.on('messageReactionAdd', async function(reaction, user) {

  // No bot on bot actions allowed
  if ( user.bot ) return;

  if( await helper.isChannelValid( reaction.message.guild.id, reaction.message.channel.id )  ) {

    helper.printStatus( `Server: ${reaction.message.guild.name}` );
    helper.printStatus( `${reaction.emoji}  By: ${user.username} on Message ID: ${reaction.message.id}` );

    let lfg_channel_id = await helper.getChannel(reaction.message.guild.id);
    let lfg_channel = reaction.message.channel;

    let member = await reaction.message.guild.members.fetch(user);
    let isAdmin = helper.isAdmin(member);

    let eventName = reaction.message.embeds[0].title ? reaction.message.embeds[0].title : "";

    if( eventName ) {

      message_id = reaction.message.id;
      eventID = await pool.query("SELECT * FROM event WHERE message_id = ? AND server_id = ? AND status = 'active' AND ( event_date IS NULL OR event_date + INTERVAL 3 HOUR >= NOW() ) LIMIT 1", [message_id, reaction.message.guild.id]).then(async function(results){
        if( results.length > 0 ) {
          return results[0].event_id;
        }
        else {

          helper.printStatus( `Message ID not found. Updating...` );

          // If eventID gets screwed up due to syncronization issues
          if( eventName.includes('Event ID:') ) {
            if( eventName.split("|").length == 3 ) {
              eventTitle = eventName.split("|").shift().trim();
              eventID = eventName.split("Event ID:").pop().trim();

              await pool.query("UPDATE event SET message_id = ? WHERE event_id = ? AND event_name = ?", [message_id, eventID, eventTitle]);
              return eventID;
            }
          }
        }
      });

      if( eventID ) {

        // CCB Clan Only
        if( (reaction.message.guild.id == config.ccbClanID || reaction.message.guild.id == config.devClanID) && (reaction.emoji.name === "🆗" || reaction.emoji.name === "🤔") ) {

          // Is clan member check and error msg
          await reaction.message.guild.members.fetch(user).then(async function(guildMember){
            if( guildMember.roles.cache.find(role => role.name === 'Members') == null ) {
              reaction.emoji.name = null;
              user.send(`Raid event signup is only open for clan members. DM the raid lead if you're interested in joining.`);

              await reaction.message.reactions.removeAll().then(async function(message){
                await raid_event.resetReactions(message);
              });
              return;
            }
          });

          // Check if already signed up in any event within last 30 mins
          if( reaction.emoji.name != null ) {
            var query = "SELECT *  FROM `event_signup` JOIN `event` ON event_signup.event_id = event.event_id"
              + " AND event_signup.user_id = ?"
              + " AND event.event_id != ?"
              + " AND event.status = 'active'"
              + " AND event.server_id = (SELECT server_id FROM event WHERE event_id = ?)"
              + " AND event.event_date <= ((SELECT event_date FROM event WHERE event_id = ?) + INTERVAL 30 MINUTE)"
              + " AND event.event_date >= ((SELECT event_date FROM event WHERE event_id = ?) - INTERVAL 30 MINUTE)";

            await pool.query(query, [user.id, eventID, eventID, eventID, eventID]).then(async function(results){

              if( results.length > 0 ) {
                reaction.emoji.name = null;
                user.send(`You're already signed up for ${results[0].event_name}. Signing up for another event that's within 30 minutes is not allowed.`);

                await reaction.message.reactions.removeAll().then(async function(message){
                  await raid_event.resetReactions(message);
                });
                return;
              }
            });
          }
        }

        if(reaction.emoji.name === "🆗") {
          reaction.message.guild.members.fetch(user).then(function(guildMember){
            raid_event.sub(reaction.message, eventID, guildMember, "confirmed", guildMember);
          });
        }

        else if(reaction.emoji.name === "🤔") {
          reaction.message.guild.members.fetch(user).then(function(guildMember){
            raid_event.sub(reaction.message, eventID, guildMember, "reserve", guildMember);
          });
        }

        else if(reaction.emoji.name === "⛔") {
          reaction.message.guild.members.fetch(user).then(function(guildMember){
            raid_event.unsub(reaction.message, eventID, guildMember);
          });
        }

        else if(reaction.emoji.name === "❌") {
          raid_event.remove(reaction.message, eventID, user);
        }

        else if(reaction.emoji.name === "👋") {

          let creator_id = await pool.query("SELECT * FROM event WHERE message_id = ? AND server_id = ? LIMIT 1", [message_id, reaction.message.guild.id]).then(function(results){
            return results[0].created_by;
          })
          .error(function(e){
            return 0;
          });

          if( user.id == creator_id || isAdmin ) {
            console.log(`Sending event signup ping for message ID: ${message_id} by: ${user.username}`);

            reaction.message.guild.members.fetch(user).then(function(guildMember){
              raid_event.pingEventSignups(reaction.message.guild.id, eventID, guildMember);
            });
          }
        }
      }
      else
        raid_event.reorder(lfg_channel);
    }
  }
});

/******************************
  Message Listener
*******************************/

client.on("message", async function(message) {

  // No bot on bot actions allowed
  if ( message.author.bot ) return;

  message.content = message.content.replace(/“/g, '"').replace(/”/g, '"');

  const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
  const prefix = message.content.charAt(0);
  const command = args.shift().toLowerCase();

  let isAdmin = helper.isAdmin(message.member);

  // Initialized channel for bot
  if ( command === "init" && prefix === config.prefix && isAdmin ) {
    await pool.query("DELETE FROM event_channel WHERE server_id = ? AND channel_id = ?", [message.guild.id, message.channel.id]).then(function(){
      pool.query("INSERT INTO event_channel SET ?", {
        server_id: message.guild.id,
        server_name: message.guild.name,
        channel_parent_id: message.channel.parentID,
        channel_parent_name: message.channel.parent.name,
        channel_id: message.channel.id,
        channel_name: message.channel.name,
        date_added: moment().format('YYYY-MM-DD HH:mm:ss')
      })
      .then(function(result){
        raid_event.getEvents(message.channel);
      });

      helper.printStatus(`Initialized channel: ${message.channel.id} for server: ${message.guild.name}`);
    });

    message.delete();
    return;
  }

  // Un-initialized channel
  if ( command === "uninit" && prefix === config.prefix && isAdmin ) {
    await pool.query("DELETE FROM event_channel WHERE server_id = ? AND channel_id = ?", [message.guild.id, message.channel.id]).then(function(results){
      if( results.affectedRows > 0 ) {
        helper.printStatus(`Removed channel: ${message.channel.id} for server: ${message.guild.name}`);
        helper.clearChannel(message.channel);
      }
    });

    return;
  }

  // Channel Found: We're good to go
  if( await helper.isChannelValid( message.guild.id, message.channel.id )  ) {

    let lfg_channel_id = await helper.getChannel(message.guild.id);
    let lfg_channel = message.channel;

    helper.printStatus( `Server: ${message.guild.name}` );
    helper.printStatus( `Message: ${message.content} By: ${message.author.username}` );

    if ( command === "event" ) {

      switch ( args[0] ) {
        case "help":
          message.author.send(config.eventHelpTxt);
          break;

        case "create":
          if ( args.length > 1 ) {
            let eventName = raid_event.parseEventNameDescription(args).eventName;
            let eventDescription = raid_event.parseEventNameDescription(args).eventDescription;
            let event_date_string = raid_event.getEventDatetimeString(eventName);

            if( raid_event.isEventDatetimeValid(event_date_string) === false || eventName.length < 7 ) {
              message.author.send('Create event failed with command: ' + message.content + '\n' + 'Please follow the format: ' + '!event create "13 Dec 8:30PM [EoW] Prestige teaching raid" "Newbies welcome"');
              break;
            }
            else {
              let eventDate = raid_event.isEventDatetimeValid(event_date_string);

              // Date is in the past
              if( moment(eventDate).isBefore( moment() ) === true ) {
                message.author.send('Create event failed with command: ' + message.content + '\n' + 'Reason => Date time provided is in the past');
                break;
              }

              // More than 1 year in the future
              if( moment(eventDate).year() - moment().year() > 1 ) {
                message.author.send('Create event failed with command: ' + message.content + '\n' + 'Reason => You can only create event up till year ' + (moment().year() + 1) );
                break;
              }
            }

            raid_event.create(lfg_channel, message, eventName, eventDescription);
          }
          else {
            raid_event.dmCreateWebLink(message);
          }
          break;

        case "delete":
          if ( args.length > 1 ) {
            let eventID = args[1];
            raid_event.remove(message, eventID, message.author);
          }
          break;

        case "edit":
          if ( args.length == 2 ) {
            let eventID = parseInt(args[1]);

            if ( eventID ) {
              raid_event.dmEditWebLink(message, eventID);
            }
            break;
          }

          else if ( args.length > 1 ) {
            let eventID = parseInt(args[1]);

            if ( eventID ) {
              args.splice(1, 1);
              let eventName = raid_event.parseEventNameDescription(args).eventName;
              let eventDescription = raid_event.parseEventNameDescription(args).eventDescription;
              let event_date_string = raid_event.getEventDatetimeString(eventName);

              if( raid_event.isEventDatetimeValid(event_date_string) === false || eventName.length < 7 ) {
                message.author.send('Edit event failed with command: ' + message.content + '\n' + 'Please follow the format: ' + '!event edit event_id "13 Dec 8:30PM [EoW] Prestige teaching raid" "Newbies welcome"');
                break;
              }
              else {
                let eventDate = raid_event.isEventDatetimeValid(event_date_string);

                // Date is in the past
                if( moment(eventDate).isBefore( moment() ) === true ) {
                  message.author.send('Edit event failed with command: ' + message.content + '\n' + 'Reason => Date time provided is in the past.');
                  break;
                }

                // More than 1 year in the future
                if( moment(eventDate).year() - moment().year() > 1 ) {
                  message.author.send('Create event failed with command: ' + message.content + '\n' + 'Reason => You can only create event up till year ' + (moment().year() + 1) );
                  break;
                }
              }

              raid_event.update(message, eventID, eventName, eventDescription);
            }
          }
          break;

        case "add":
          if ( args.length > 1 && message.mentions.users.first() ) {
            let eventID = parseInt(args[1]);
            let players = message.mentions.users;
            let type = lodash.last(args);
            type = (type == "reserve") ? "reserve" : "confirmed";

            if( eventID ) {
              for( var p of players.values() ) {
                await message.guild.members.fetch(p).then(function(member){
                  if(member.user.bot == false)
                    raid_event.add2Event(message, eventID, type, message.member, member);
                });
              }
            }
          }
          break;

        case "remove":
          if ( args.length > 1 && message.mentions.users.first() ) {
            let eventID = parseInt(args[1]);
            let players = message.mentions.users;

            if( eventID ) {
              for( var p of players.values() ) {
                await message.guild.members.fetch(p).then(function(member){
                  raid_event.removeFromEvent(message, eventID, message.author, member);
                });
              }
            }
          }
          break;

        case "comment":
          if ( args.length > 1 ) {
            let eventID = parseInt(args[1]);
            let player = message.author;
            let comment =  args.slice(2, args.length).join(" ") ? args.slice(2, args.length).join(" ") : "";

            if( eventID ) {
              raid_event.addComment(message, eventID, player, comment);
            }
          }
          break;

        case "move":
        case "mv":
          if ( args.length > 1 ) {
            let eventID = parseInt(args[1]);
            raid_event.mvEvent(message, eventID);
          }
          break;

        case "copy":
        case "cp":
          if ( args.length > 1 ) {
            let eventID = parseInt(args[1]);
            raid_event.cpEvent(message, eventID);
          }
          break;

        case "donate":
          let donationTitle = "```md\n# Donation Link```" + "```md\n# If you've found the bot useful and would like to donate, you can do so via the link below. Donations will be used to cover server hosting fees. Thanks!```";

          message.author.send(donationTitle);

          let embed1 = new Discord.MessageEmbed()
            .setTitle("1. Buy a Coffee via Ko-fi :link:")
            .setColor("#29abe0")
            .setURL('https://ko-fi.com/xenodus')
            .setThumbnail('https://uploads-ssl.webflow.com/5c14e387dab576fe667689cf/5ca5bf1dff3c03fbf7cc9b3c_Kofi_logo_RGB_rounded-p-500.png');

          message.author.send( embed1 );
          break;

        // Search
        default:
          raid_event.search(args[0], message.author, lfg_channel);
          break;
      }
    }

    else if ( command === "reorder" ) {
      if ( isAdmin ) {
        raid_event.reorder(lfg_channel);
      }
    }

    else if ( command === "clear" ) {
      if ( isAdmin ) {
        helper.clearChannel(lfg_channel);
      }
    }

    else if ( command === "refresh" ) {
      if ( isAdmin ) {
        raid_event.getEvents(lfg_channel);
      }
    }

    // Housekeep channel
    message.delete();
  }
});