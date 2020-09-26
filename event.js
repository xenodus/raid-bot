/******************************
  Variables & Libs
*******************************/

const helper = require("./helper.js");
const moment = require("moment");
const Discord = require("discord.js");
const Hashids = require('hashids');

/******************************
  Event Obj
*******************************/

function Event(client, config) {
  var self = this;
  var pool = config.getPool();

  self.getEventDatetimeString = function(eventName) {
    let indexOfTab = eventName.indexOf("[");

    if( indexOfTab >= 0 ) {
      let s = eventName.substring(0, indexOfTab-1);
      s = s.replace(/today/i, moment().format('D MMM'));
      s = s.replace(/tdy/i, moment().format('D MMM'));
      s = s.replace(/tomorrow/i, moment().add(1, 'days').format('D MMM'));
      s = s.replace(/tmr/i, moment().add(1, 'days').format('D MMM'));

      return s;
    }
    else
      return '';
  }

  self.isEventDatetimeValid = function(event_date_string) {

    let eventDatetimeFormats = config.eventDatetimeFormats;

    for(var key in eventDatetimeFormats) {
      if( moment(event_date_string, eventDatetimeFormats[key], true).isValid() )
        return moment( event_date_string, eventDatetimeFormats[key] ).format('YYYY-MM-DD HH:mm:ss')
    }

    // If no matches from strict match, check for no time specified
    if( moment(event_date_string, 'D MMM', true).isValid() )
      return moment( event_date_string, 'D MMM' ).format('YYYY-MM-DD 23:59:59')

    return false;
  }

  self.parseEventNameDescription = function(args) {
    let recompose = args.slice(1, args.length).join(" ");
    let indices = []; // find the indices of the quotation marks

    for (var i in recompose) {
        let char = recompose[i];
      if (char === '"') {
        indices.push(i);
      }
    }

    let eventName = '';
    let eventDescription = '';

    if (indices.length == 0) {
      eventName = args.slice(1, args.length).join(" ");
    }
    else if(indices.length == 2) {
      eventName = recompose.substring(indices[0] + 1, indices[1]);

      let nameLength = parseInt(indices[1]) + 1;
      if ( recompose.length > nameLength ) {
        eventDescription = recompose.substring(nameLength+1);
      }
    }
    else if(indices.length == 4) {
      eventName = recompose.substring(indices[0] + 1, indices[1]);
      eventDescription = recompose.substring(parseInt(indices[2]) + 1, indices[3]);
    }
    else {
      eventName = args.slice(1, args.length).join(" ");
      eventName = eventName.replace(/"/g,'');
    }

    // Today / Tomorrow / Tmr Short Text
    eventName = eventName.replace(/today/i, moment().format('D MMM'));
    eventName = eventName.replace(/tdy/i, moment().format('D MMM'));
    eventName = eventName.replace(/tomorrow/i, moment().add(1, 'days').format('D MMM'));
    eventName = eventName.replace(/tmr/i, moment().add(1, 'days').format('D MMM'));

    return {
      eventName: eventName,
      eventDescription: eventDescription
    };
  }

  /******************************
      Create Event Web Link
  *******************************/

  self.dmCreateWebLink = async function(message) {

    await message.guild.members.fetch(message.author).then(async function(member){

      creator = member.nickname ? member.nickname : member.user.username;

      await pool.query("INSERT into event_token SET ?",
      { server_id: message.guild.id,
        channel_id: message.channel.id,
        user_id: message.author.id,
        username: creator,
        event_id: 0,
        token: '',
        status: 'active',
        expires: moment().add(config.weblinkExpiry, 'minutes').format('YYYY-M-D HH:mm:ss'),
        date_added: moment().format('YYYY-M-D HH:mm:ss')
      }).then(async function(result){
        if( result.insertId ) {
          let hashid = new Hashids(config.hashIDSalt, 6, 'abcdefghijklmnopqrstuvwxyz0123456789'); // pad to length 10
          let hash = hashid.encode(result.insertId);

          await pool.query("UPDATE event_token SET token = ? WHERE id = ?", [hash, result.insertId]).then(function(){
            message.author.send("Event create web link: <" + config.weblinkBaseUrl + hash + ">. Link expires in " + config.weblinkExpiry + " minutes.");
          })
        }
      });

    });
  }

  /******************************
      Edit Event Web Link
  *******************************/

  self.dmEditWebLink = async function(message, eventID) {

    await message.guild.members.fetch(message.author).then(async function(member){

      creator = member.nickname ? member.nickname : member.user.username;

      await pool.query("SELECT * FROM event WHERE event_id = ? AND server_id = ?", [eventID, message.guild.id])
      .then(async function(results){
        if( results.length > 0 ) {

          if ( results[0].created_by == message.author.id ) {

            await pool.query("INSERT into event_token SET ?",
            { server_id: message.guild.id,
              channel_id: message.channel.id,
              user_id: message.author.id,
              username: creator,
              event_id: eventID,
              token: '',
              status: 'active',
              expires: moment().add(config.weblinkExpiry, 'minutes').format('YYYY-M-D HH:mm:ss'),
              date_added: moment().format('YYYY-M-D HH:mm:ss')
            }).then(async function(result){
              if( result.insertId ) {
                let hashid = new Hashids(config.hashIDSalt, 6, 'abcdefghijklmnopqrstuvwxyz0123456789'); // pad to length 10
                let hash = hashid.encode(result.insertId);

                await pool.query("UPDATE event_token SET token = ? WHERE id = ?", [hash, result.insertId]).then(function(){
                  message.author.send("Event edit web link: <" + config.weblinkBaseUrl + hash + ">. Link expires in " + config.weblinkExpiry + " minutes.");
                })
              }
            });
          }
        }
      });
    });
  }

  /******************************
            Create Event
  *******************************/

  self.create = async function(channel, message, eventName, eventDescription) {
    await channel.guild.members.fetch(message.author).then(async function(member){

      creator = member.nickname ? member.nickname : member.user.username;
      event_date_string = self.getEventDatetimeString(eventName);
      event_date = self.isEventDatetimeValid(event_date_string) ? self.isEventDatetimeValid(event_date_string) : null;

      // Future Check
      if( event_date ) {
        e = moment( event_date, 'YYYY-MM-DD HH:mm:ss' ).format('YYYY-MM-DD');

        if( moment().diff( e, 'days' ) > 0 ) {
          event_date = moment( event_date, 'YYYY-MM-DD HH:mm:ss' ).add(1, 'years').format('YYYY-MM-DD HH:mm:ss')
        }
      }

      await pool.query("INSERT into event SET ?",
      { server_id: channel.guild.id,
        channel_id: channel.id,
        event_name: eventName,
        event_description: eventDescription,
        event_date: event_date,
        created_by: message.author.id,
        created_by_username: creator,
        date_added: moment().format('YYYY-M-D HH:mm:ss')
      })
      .then(async function(result){

        await pool.query("SELECT * FROM event WHERE event_id = ? AND server_id = ?", [result.insertId, channel.guild.id])
        .then(async function(results){
          var rows = JSON.parse(JSON.stringify(results));
          let event = rows[0];

          await pool.query("SELECT * FROM event_signup LEFT JOIN event on event_signup.event_id = event.event_id WHERE event_signup.event_id = ? ORDER BY event_signup.date_added ASC", [event.event_id])
          .then(async function(results){

            let eventInfo = self.getEventInfo(event, results);

            await channel.send( eventInfo.messageEmbed ).then(async function(message){
              await pool.query("UPDATE event SET message_id = ? WHERE event_id = ?", [message.id, event.event_id]);
              await self.resetReactions(message);
            }); // eventChannel send message
          }); // select event_signup
        }); // select event

        return result;
      }) // insert event
      .then(async function(result){
        await channel.guild.members.fetch(message.author).then(async function(member){
          await self.sub(message, result.insertId, member);
        });

        // for fun feature for CCB
        if( channel.guild.id == config.ccbClanID ) {
          if( eventName.toLowerCase().includes('overcook') && message.author.id == '313372577592639489' ) {
            // fetch my user
            let xenodus = message.guild.members.cache.get('154572358051430400');
            await self.sub(message, result.insertId, xenodus);
          }
        }
      });
    }) // fetch member
    .then(function(){
      self.reorder(channel);
    });
  };

  /******************************
        Update / Edit Event
  *******************************/

  self.update = async function(message, eventID, eventName, eventDescription) {
    // Check if event belong to server before proceeding
    await pool.query("SELECT * FROM event WHERE event_id = ? AND server_id = ?", [eventID, message.guild.id])
    .then(async function(results){
      if( results.length > 0 ) {
        await pool.query("SELECT * FROM event WHERE event_id = ?", [eventID])
        .then(async function(results){
          var rows = JSON.parse(JSON.stringify(results));

          if ( rows[0] ) {
            event = rows[0];
          }

          if ( event.created_by == message.author.id ) {
            event_date_string = self.getEventDatetimeString(eventName);
            event_date = self.isEventDatetimeValid(event_date_string) ? self.isEventDatetimeValid(event_date_string) : null;

            // Future Check
            if( event_date ) {
              e = moment( event_date, 'YYYY-MM-DD HH:mm:ss' ).format(moment().year()+'-MM-DD');

              if( moment().diff( e, 'days' ) > 0 ) {
                event_date = moment( event_date, 'YYYY-MM-DD HH:mm:ss' ).add(1, 'years').format('YYYY-MM-DD HH:mm:ss')
              }
            }
            helper.printStatus( "Updating event ID: " + eventID );

            return await pool.query("UPDATE event SET event_name = ?, event_description = ?, event_date = ? WHERE event_id = ?", [eventName, eventDescription, event_date, eventID]);
          }

        })
        .then(function(){
          self.updateEventMessage(eventID, message.channel);
        })
        .then(function(){
          self.reorder(message.channel);
        })
      }
      else {
        helper.printStatus( 'Event update failed for event ID: ' + eventID + ' in channel ' + message.guild.name );
      }
    });
  }

  /******************************
        Join / Sub Event
  *******************************/

  self.sub = function(message, eventID, player, type="confirmed", addedByUser="") {
    // Check if event belong to server before proceeding
    pool.query("SELECT * FROM event WHERE event_id = ? AND server_id = ?", [eventID, message.guild.id]).then(function(results){

      if( results.length > 0 ) {

        let event_name = results[0].event_name;

        pool.query("DELETE FROM event_signup where event_id = ? AND user_id = ?", [eventID, player.id]).then(function(results){

          let username = player.nickname ? player.nickname : player.user.username;

          helper.printStatus( "Joining event ID: " + eventID + " for player, " + username + " as " + type + " for event, " + event_name);

          if ( addedByUser ) {
            let addedByUserName = addedByUser.nickname ? addedByUser.nickname : addedByUser.user.username;
            return pool.query("INSERT into event_signup SET ?", {event_id: eventID, username: username, user_id: player.id, type: type, added_by_user_id: addedByUser.id, added_by_username: addedByUserName, date_added: moment().format('YYYY-M-D H:m:s')});
          }
          else
            return pool.query("INSERT into event_signup SET ?", {event_id: eventID, username: username, user_id: player.id, type: type, date_added: moment().format('YYYY-M-D H:m:s')});
        })
        .then(function(results){
          self.updateEventMessage(eventID, message.channel);
        });
      }
      else {
        helper.printStatus( 'Event join failed for event ID: ' + eventID + ' in channel ' + message.guild.name );
      }
    });
  }

  /******************************
        Sub/Add user to Event
  *******************************/

  self.add2Event = function(message, eventID, type, user, player) {
    pool.query("SELECT * FROM event WHERE event_id = ? ", [eventID])
    .then(function(results){
      var rows = JSON.parse(JSON.stringify(results));

      if( rows[0].created_by == user.id || helper.isAdmin(message.member) ) {
        self.sub(message, eventID, player, type, user);
        let username = player.nickname ? player.nickname : player.user.username;
        helper.printStatus( "Player " +username+ " added to event ID: " + eventID );
      }
    });
  }

  /******************************
        Unsub from Event
  *******************************/

  self.unsub = function(message, eventID, player) {
    // Check if event belong to server before proceeding
    pool.query("SELECT * FROM event WHERE event_id = ? AND server_id = ?", [eventID, message.guild.id]).then(function(results){
      if( results.length > 0 ) {
        let username = player.nickname ? player.nickname : player.user.username;
        helper.printStatus( "Unsubbed from event ID: " + eventID + " for player, " + username + " for event, " + results[0].event_name );
        pool.query("DELETE FROM event_signup where event_id = ? AND user_id = ?", [eventID, player.id]).then(function(results){
          self.updateEventMessage(eventID, message.channel);
        });
      }
      else {
        helper.printStatus( 'Event withdraw failed for event ID: ' + eventID + ' in channel ' + message.guild.name );
      }
    });
  }

  /******************************
    Unsub/Remove user to Event
  *******************************/

  self.removeFromEvent = function(message, eventID, user, player) {
    pool.query("SELECT * FROM event WHERE event_id = ? ", [eventID])
    .then(function(results){
      var rows = JSON.parse(JSON.stringify(results));

      if( rows[0].created_by == user.id || helper.isAdmin(message.member) ) {
        self.unsub(message, eventID, player);
        let username = player.nickname ? player.nickname : player.username;
        helper.printStatus( "Removed player " +username+ " from event ID: " + eventID );
      }
    });
  }

  /******************************
            Delete Event
  *******************************/

  self.remove = async function(message, eventID, author) {
    // Check if event belong to server before proceeding
    pool.query("SELECT * FROM event WHERE event_id = ? AND server_id = ?", [eventID, message.guild.id]).then(function(results){

      if( results.length > 0 ) {
        pool.query("SELECT * FROM event WHERE event_id = ? AND status = 'active'", [eventID]).then(function(results){

          var rows = JSON.parse(JSON.stringify(results));

          if ( rows[0] )
            event = rows[0];
          else
            return;

          if ( event.created_by == author.id || helper.isAdmin(message.member) ) {
            helper.printStatus( 'Deleted Event ID: ' + eventID + ' "' + event.event_name + '"');

            message.channel.messages.fetch(event.message_id).then(function(message){
              message.delete();
            });
            return pool.query("UPDATE event SET status = 'deleted' WHERE event_id = ?", [eventID]);
          }
        });
      }
      else {
        helper.printStatus( 'Event deletion failed for event ID: ' + eventID + ' in channel ' + message.guild.name );
      }
    });
  }

  /******************************
        Add Comment to Sub
  *******************************/

  self.addComment = function(message, eventID, user, comment) {
    // Check if event belong to server before proceeding
    pool.query("SELECT * FROM event WHERE event_id = ? AND server_id = ?", [eventID, message.guild.id])
    .then(function(results){
      if( results.length > 0 ) {
        pool.query("UPDATE event_signup SET comment = ? WHERE event_id = ? AND user_id = ?", [comment, eventID, user.id])
        .then(function(results){
          self.updateEventMessage(eventID, message.channel);
        });
      }
      else {
        helper.printStatus( 'Add comment failed for event ID: ' + eventID + ' in channel ' + message.guild.name );
      }
    });
  }

  /******************************
       Refresh Event Msg
  *******************************/

  self.updateEventMessage = async function(eventID, channel) {
    let serverID = channel.guild.id;

    await pool.query("SELECT * FROM event WHERE event_id = ? AND server_id = ?", [eventID, serverID])
    .then(function(results){
      var event = JSON.parse(JSON.stringify(results));
      return event;
    })
    .then(async function(event){
      if( event.length > 0 ) {
        await pool.query("SELECT * FROM event_signup LEFT JOIN event on event_signup.event_id = event.event_id WHERE event_signup.event_id = ? AND event.server_id = ? ORDER BY event_signup.date_added ASC", [eventID, serverID])
        .then(async function(results){

          if( event[0].message_id > 0 ) {

            let eventInfo = self.getEventInfo(event[0], results);

            await channel.messages.fetch(event[0].message_id)
            .then(async function(message){
              await message.edit( eventInfo.messageEmbed ).then(async function(message){
                await message.reactions.removeAll().then(async function(message){
                  await self.resetReactions(message);
                });
              });
            });
          }
        });
      }
    });
  }

  /******************************
     Get Msg Content of Event
  *******************************/

  self.getEventInfo = function(event, signUps, maxConfirmed=6) {
    var signupsRows = JSON.parse(JSON.stringify(signUps));
    var confirmed = "";
    var confirmedCount = 1;
    var reserve = "";
    var reserveCount = 1;
    var creator = event.created_by_username ? event.created_by_username : "";

    for(var i = 0; i < signupsRows.length; i++) {
      if( signupsRows[i].type == 'confirmed' ) {
        confirmed += confirmedCount + ". " + signupsRows[i].username.replace('_', '\\_') + ( signupsRows[i].comment ? ("\n- _" + signupsRows[i].comment + "_"):"" ) + "\n";
        confirmedCount++;
      }
      else {
        reserve += reserveCount + ". " + signupsRows[i].username.replace('_', '\\_') + ( signupsRows[i].comment ? ("\n- _" + signupsRows[i].comment + "_"):"" ) +"\n";
        reserveCount++;
      }
    }

    if ( confirmed === "" ) confirmed = "nil";
    if ( reserve === "" ) reserve = "nil";

    let color = self.detectRaidColor( event.event_name );

    // Get Day of Event
    var eventDay = moment.utc(event.event_date).local().format('dddd');

    // Customized Event Name
    if( moment.utc(event.event_date).year() > moment().year() ) {
      var displayEventName = moment.utc(event.event_date).local().format('D MMM YYYY h:mmA') + " " + event.event_name.substring( event.event_name.indexOf("[") );
    }
    else {
      var displayEventName = moment.utc(event.event_date).local().format('D MMM h:mmA') + " " + event.event_name.substring( event.event_name.indexOf("[") );
    }

    // "Event ID" string used in detection of reaction
    var messageEmbed = new Discord.MessageEmbed()
      .setTitle( displayEventName + " | \\*\\*" +eventDay+ "\\*\\* | Event ID: " + event.event_id )
      .setColor( color )
      .setDescription( event.event_description );

    messageEmbed.addField("Confirmed", confirmed, true);
    messageEmbed.addField("Reserve", reserve, true);

    if (creator)
      messageEmbed.addField("Created By", creator);

    return {
      messageEmbed: messageEmbed,
      confirmedCount: confirmedCount,
      reserveCount: reserveCount
    };
  }

  /******************************
      Raid colors for embed
  *******************************/

  self.detectRaidColor = function(eventName) {
    if ( eventName.toLowerCase().includes("levi") )
      return config.raidColorMapping['Levi'];
    else if ( eventName.toLowerCase().includes("eow") || eventName.toLowerCase().includes("eater") )
      return config.raidColorMapping['EOW'];
    else if ( eventName.toLowerCase().includes("sos") || eventName.toLowerCase().includes("spire") )
      return config.raidColorMapping['SOS'];
    else if ( eventName.toLowerCase().includes("lw") || eventName.toLowerCase().includes("wish") )
      return config.raidColorMapping['Wish'];
    else if ( eventName.toLowerCase().includes("sotp") || eventName.toLowerCase().includes("scourge") )
      return config.raidColorMapping['Scourge'];
    else if ( eventName.toLowerCase().includes("cos") || eventName.toLowerCase().includes("crown") )
      return config.raidColorMapping['COS'];
    else if ( eventName.toLowerCase().includes("gos") || eventName.toLowerCase().includes("garden") )
      return config.raidColorMapping['GOS'];
    else
      return config.raidColorMapping['default'];
  }

  /******************************
          Search Events
  *******************************/
  self.search = function(searchStr, player, channel) {
    pool.query("SELECT * FROM event WHERE server_id = ? AND channel_id = ? AND event_name LIKE ? AND status = 'active' AND ( event_date IS NULL OR event_date >= CURDATE() ) ORDER BY event_date ASC", [channel.guild.id, channel.id, '%'+searchStr+'%'])
    .then(async function(results){

      var rows = JSON.parse(JSON.stringify(results));

      var messageEmbed = new Discord.MessageEmbed()
        .setTitle("Your search for events matching __"+searchStr+"__ resulted in " + rows.length + " results.")
        .setColor("#DB9834");

      player.send(messageEmbed);

      for(var i = 0; i < rows.length; i++) {

        let event = rows[i];

        await pool.query("SELECT * FROM event_signup LEFT JOIN event on event_signup.event_id = event.event_id WHERE event_signup.event_id = ? ORDER BY event_signup.date_added ASC", [event.event_id])
        .then(async function(results){

          let eventInfo = self.getEventInfo(event, results);

          player.send(eventInfo.messageEmbed);
        });
      }
    });
  }

  /******************************
        Get & Refresh Event
  *******************************/

  self.getEvents = async function(eventChannel) {

    await helper.clearChannel(eventChannel);

    var messageEmbed = new Discord.MessageEmbed()
      .setTitle("Instructions")
      .setColor("#DB9834")
      .setDescription("Sign up to events by reacting :ok: to __confirm__ :thinking: to __reserve__ :no_entry: to __withdraw__");

    var commandDesc = '__Create event via website__ \n!event create\n\n__Create event via command line__ \n!event create "13 Dec 8:30PM [EoW]" "Prestige teaching raid. Newbies welcome."\n\n__Please follow the standard format__ \n"Day Month Time [Your Event Name]" "Optional Description"\n\n__Full command list__ \n!event help\n\n__Tips__ \n1. You can also use "today" or "tomorrow" for the day & month';

    if( eventChannel.guild.id == config.ccbClanID || eventChannel.guild.id == config.devClanID ) {
      commandDesc += '\n2. You can receive new event notifications through our [Telegram bot](https://telegram.me/alfredevent_bot)';
    }

    messageEmbed.addField("Quick Commands", commandDesc);

    eventChannel.send( "If you're unable to see anything in this channel, make sure User Settings > Text & Images > Link Preview is checked." );
    eventChannel.send( messageEmbed );

    pool.query("SELECT * FROM event WHERE server_id = ? AND channel_id = ? AND status = 'active' AND ( event_date IS NULL OR event_date + INTERVAL 3 HOUR >= NOW() ) ORDER BY event_date IS NULL DESC, event_date ASC", [eventChannel.guild.id, eventChannel.id])
    .then(async function(results){

      var rows = JSON.parse(JSON.stringify(results));

      for(var i = 0; i < rows.length; i++) {

        let event = rows[i];

        await pool.query("SELECT * FROM event_signup LEFT JOIN event on event_signup.event_id = event.event_id WHERE event_signup.event_id = ? ORDER BY event_signup.date_added ASC", [event.event_id])
        .then(async function(results){

          let eventInfo = self.getEventInfo(event, results);

          helper.printStatus( 'Printing Event ID ' + event.event_id + ': "' + event.event_name + '" by: ' + event.created_by_username + " for channel: " +eventChannel.name+ " on server: " + eventChannel.guild.name );

          await eventChannel.send( eventInfo.messageEmbed ).then(async function(message){

            await self.resetReactions(message);

            client.users.fetch(event.created_by).then(function(user){
              eventChannel.guild.members.fetch(user).then(function(member){
                let creator = member.nickname ? member.nickname : member.user.username;
                pool.query("UPDATE event SET message_id = ?, created_by_username = ? WHERE event_id = ?", [message.id, creator, event.event_id]);
              }) // fetch member
            }); // fetch user
          }); // event channel send message
        }); // select event signups
      } // for loop events
    }); // select events
  }

  /******************************
     Ping Signups of Events
  *******************************/
  self.pingEventSignups = function(serverID, eventID, author) {
    pool.query("SELECT * FROM event_signup LEFT JOIN event ON event_signup.event_id = event.event_id WHERE event_signup.event_id = ? AND event.server_id = ?", [eventID, serverID])
    .then(function(results){
      var rows = JSON.parse(JSON.stringify(results));
      let pinger = author.nickname ? author.nickname : author.user.username;

      // For each sign up users
      for(var i = 0; i < rows.length; i++) {
        if( rows[i].created_by && rows[i].user_id ) {
          let creator_id = rows[i].created_by;
          let signup_id = rows[i].user_id;
          let event_name = rows[i].event_name;

          client.users.fetch(creator_id).then(function(creator){
            return creator;
          }).then(function(creator){
            client.users.fetch(signup_id).then(function(signup){
              signup.send("This is an alert by " + pinger + " / <@"+author.id+"> regarding event, __" + event_name + "__");
            });
          });
        }
      }
    });
  }

  /******************************
    Resend Missing Event Messages
  *******************************/

  self.detectMissing = async function(eChannel) {
    helper.printStatus( "Checking for missing events for channel: " + eChannel.name + " on server: " + eChannel.guild.name );

    try {

      await eChannel.messages.fetch().then(async function(messages){

        let current_event_messages = messages.filter(function(msg){
          return msg.embeds.length > 0 && msg.embeds[0].title && msg.embeds[0].title.includes('Event ID:')
        });

        let current_event_messages_ids = current_event_messages.map(function(msg){
          return msg.id;
        });

        await pool.query("SELECT * FROM event WHERE server_id = ? AND channel_id = ? AND status = 'active' AND ( event_date IS NULL OR event_date + INTERVAL 3 HOUR >= NOW() ) ORDER BY event_date IS NULL DESC, event_date ASC", [eChannel.guild.id, eChannel.id])
        .then(async function(results){

          var rows = JSON.parse(JSON.stringify(results));

          if( rows.length > 0 && rows.length > current_event_messages_ids.length ) {

            for( var i=0; i<rows.length; i++ ) {

              let event = rows[i];

              if( current_event_messages_ids.includes( event.message_id ) == false ) {

                helper.printStatus( 'Event ID: ' + event.event_id + " missing for channel: " +eChannel.name+ " on server: " + eChannel.guild.name);

                // If event in DB not found in channel - create it
                await pool.query("SELECT * FROM event_signup LEFT JOIN event on event_signup.event_id = event.event_id WHERE event_signup.event_id = ? ORDER BY event_signup.date_added ASC", [event.event_id])
                .then(async function(results){
                  let eventInfo = self.getEventInfo(event, results);

                  await eChannel.send( eventInfo.messageEmbed ).then(async function(message){
                    await pool.query("UPDATE event SET message_id = ? WHERE event_id = ?", [message.id, event.event_id]);
                    await self.resetReactions(message);
                  });
                });
              }
            }
          }
        });
      });

      // Check for missing reactions
      await eChannel.messages.fetch().then(async function(messages){

        let current_event_messages = messages.filter(function(msg){
          return msg.embeds.length > 0 && msg.embeds[0].title && msg.embeds[0].title.includes('Event ID:')
        });

        current_event_messages.each(async function(m){
          if( m.reactions.cache.size == 0 ) {
            await self.resetReactions(m);
          }
        });
      });
    }
    catch(e) {
      console.log(e);

      if( e.code == 50001 ) {
        await pool.query("DELETE FROM event_channel WHERE server_id = ? AND channel_id = ?", [eChannel.guild.id, eChannel.id])
        .then(async function(results){
          await helper.printStatus("Removing channel " +eChannel.name+ " for server: " + eChannel.guild.name);
        });
      }
    }
  }

  /******************************
      Reorder Event Messages
  *******************************/

  self.reorder = async function(eChannel) {

    await self.detectMissing(eChannel);

    helper.printStatus("Reordering channel " +eChannel.name+ " for server: " + eChannel.guild.name);

    try {

      await eChannel.messages.fetch().then(async function(messages){

        let current_event_messages = messages.filter(function(msg){
          return msg.embeds.length > 0 && msg.embeds[0].title && msg.embeds[0].title.includes('Event ID:')
        });

        let current_event_messages_ids = current_event_messages.map(function(msg){
          return msg.id;
        });

        current_event_messages_ids = current_event_messages_ids.sort();

        if( current_event_messages_ids.length > 0 ) {
          // Get active events
          await pool.query("SELECT * FROM event WHERE server_id = ? AND channel_id = ? AND status = 'active' AND ( event_date IS NULL OR event_date + INTERVAL 3 HOUR >= NOW() ) ORDER BY event_date IS NULL DESC, event_date ASC", [eChannel.guild.id, eChannel.id])
          .then(async function(results){
            var rows = JSON.parse(JSON.stringify(results));

            for(var i = 0; i < rows.length; i++) {

              let event = rows[i];

              await pool.query("SELECT * FROM event_signup LEFT JOIN event on event_signup.event_id = event.event_id WHERE event_signup.event_id = ? ORDER BY event_signup.date_added ASC", [event.event_id])
              .then(async function(results){
                eventInfo = self.getEventInfo(event, results);
                curr_event_message = current_event_messages.filter(e => { return e.id === event.message_id }).values().next().value;
                curr_event_message_id_to_edit = current_event_messages_ids.shift();

                if( curr_event_message_id_to_edit ) {
                  await eChannel.messages.fetch(curr_event_message_id_to_edit)
                  .then(async function(msg){

                    if( msg.embeds[0].title != eventInfo.messageEmbed.title ){
                      helper.printStatus("Reordered event ID: " + event.event_id + " from message ID: " + event.message_id + " to " + curr_event_message_id_to_edit + " for server: " + eChannel.guild.name);
                      await pool.query("UPDATE event SET message_id = ? WHERE event_id = ?", [curr_event_message_id_to_edit, event.event_id]);
                      await msg.edit( eventInfo.messageEmbed );
                    }
                  });
                }
              });
            }

            // delete any ids that remains
            if( current_event_messages_ids.length > 0 ) {
              for(var i=0;i<current_event_messages_ids.length;i++) {
                await eChannel.messages.fetch(current_event_messages_ids[i])
                .then(async function(msg){
                  helper.printStatus("Deleting message ID: " + current_event_messages_ids[i] + " with title: " + msg.embeds[0].title );
                  msg.delete();
                })
                .catch(function(e){
                  console.log(e);
                });
              }
            };
          })
        }
        else
          helper.printStatus("No active events to reorder for server: " + eChannel.guild.name);

        // update any expired events
        await self.autoExpireEvent();
        helper.printStatus("Finished reordering channel " +eChannel.name+ " for server: " + eChannel.guild.name);
      });
    }
    catch(e) {
      console.log(e);

      if( e.code == 50001 ) {
        await pool.query("DELETE FROM event_channel WHERE server_id = ? AND channel_id = ?", [eChannel.guild.id, eChannel.id])
        .then(async function(results){
          await helper.printStatus("Removing channel " +eChannel.name+ " for server: " + eChannel.guild.name);
        });
      }
    }
  }

  /******************************
      Expire Event Messages
  *******************************/

  self.autoExpireEvent = async function() {
    // update any expired events
    return await pool.query("UPDATE event SET message_id = '', status = 'deleted' WHERE status  = 'active' AND event_date + INTERVAL 3 HOUR < NOW()");
  }

  /******************************
      Message Reaction Reset
  *******************************/

  self.resetReactions = async function(message) {
    await message.react('🆗');
    await message.react('🤔');
    await message.react('⛔');
  }

  /******************************************
      Copy Event from Channel to create
  *******************************************/

  self.cpEvent = async function(message, eventID) {
    // Ensure event ID is valid for the current channel
    await pool.query("SELECT * FROM event WHERE channel_id = ? AND event_id = ? AND status = 'active' AND ( event_date IS NULL OR event_date >= CURDATE() )", [message.channel.id, eventID]).then(async function(results){
      if( results.length > 0 ) {

        let eventName = results[0].event_name;
        let eventDescription = results[0].event_description;

        self.create(message.channel, message, eventName, eventDescription);
      }
    });
  }

  /**************************************
      Move Message Between Channels
  ***************************************/

  self.mvEvent = async function(message, eventID) {

    if( message.mentions.channels.size ) {
      let targetChannel = message.mentions.channels.first();

      // Ensure different channel
      if( targetChannel.id != message.channel.id ) {
        // Ensure event ID is valid for the current channel
        await pool.query("SELECT * FROM event WHERE channel_id = ? AND event_id = ? AND status = 'active' AND ( event_date IS NULL OR event_date >= CURDATE() )", [message.channel.id, eventID]).then(async function(results){
          if( results.length > 0 ) {

            let currentMessageID = results[0].message_id;

            // Ensure target channel is a valid initialized lfg channel
            await pool.query("SELECT * FROM event_channel WHERE server_id = ? AND channel_id = ?", [message.guild.id, targetChannel.id]).then(async function(results){
              if( results.length > 0 ) {
                // Move
                await pool.query("UPDATE event SET channel_id = ? WHERE event_id = ?", [targetChannel.id, eventID]).then(async function(results){
                  // Delete previous message
                  await message.channel.messages.fetch(currentMessageID).then(async function(message){
                    await message.delete();
                    await self.reorder(targetChannel);
                  });
                });
              }
              else {
                message.author.send('Event move failed. Target destination channel has not been initialized as an event channel yet.');
              }
            });
          }
          else {
            message.author.send('Event move failed. Event not found.');
          }
        });
      }
      else {
        message.author.send('Event move failed. Target destination channel is similar to current channel.');
      }
    }
    else {
      message.author.send('Event move failed. No destination channel was mentioned.');
    }
  }
}

module.exports = {
  Event: Event
}