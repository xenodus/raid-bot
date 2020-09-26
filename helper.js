/******************************
  Variables & Libs
*******************************/

const moment = require("moment");
const config = require('./config').production;
const pool = config.getPool();

/******************************
  Helper Functions
*******************************/

module.exports = {

  refreshAllServers: async function(client, raid_event) {
    // Refresh events in all servers on start-up
    for( var guild of client.guilds.cache.values() ) {
      if( guild.available ) {
        pool.query("SELECT * FROM event_channel WHERE server_id = ?", [guild.id]).then(async function(results){
          if( results.length > 0 ) {
            for( var i = 0; i<results.length; i++ ) {
              let channel = await client.channels.cache.get(results[i].channel_id);

              if( channel ) {
                await raid_event.getEvents(channel);
              }
            }
          }
        });
      }
    }
  },

  updateGuildChannels: async function(client, raid_event) {
    console.log("-- Begin reorder check --");

    if( client.guilds.cache.size > 0 ) {
      for( var guild of client.guilds.cache.values() ) {
        if( guild.available ) {
          await pool.query("SELECT * FROM event_channel WHERE server_id = ?", [guild.id]).then(async function(results){
            if( results.length > 0 ) {
              for( var i = 0; i<results.length; i++ ) {
                let channel = await client.channels.cache.get(results[i].channel_id);

                if( channel && channel.guild.id == guild.id ) {
                  await raid_event.reorder(channel);
                }
              }
            }
          });
        }
      }
    }

    console.log("-- End reorder check --");
    return;
  },

  // Print to console with timestamp prefix
  isAdmin: function(member) {
    if (  member.hasPermission('ADMINISTRATOR') ||
          member.hasPermission('MANAGE_CHANNELS') ||
          // member.roles.cache.find(roles => roles.name === "Admin") ||
          Object.keys(config.adminIDs).includes(member.id) )
      return true;
    else
      return false;
  },

  // Print to console with timestamp prefix
  printStatus: function(text) {
    console.log( "[" + moment().format() + "] " + text );
  },

  // Purge channel
  clearChannel: async function(channel) {
    try {
      await channel.messages.fetch().then(async function(messages){

        mids = messages.map(m => m.id);

        if( mids.length > 0 ) {
          for( var mid of mids ) {
            await channel.messages.fetch(mid).then(async function(m){
              if( m ) {
                try {
                  await m.delete();
                }
                catch(e) {
                  console.log("DELETE MESSAGE ERROR", e);

                  if( e.message && e.message === 'Missing Permissions' ) {
                    channel.send("Error encountered: I require permission to delete messages in this channel");
                  }
                }
              }
            });
          }
        }
      });
    }
    catch(e) {
      console.log("CLEAR CHANNEL ERROR", channel, e);
      return;
    }
  },

  // Check if channel belongs to server and is initialized
  isChannelValid: async function(server_id, channel_id) {
    return await pool.query("SELECT * FROM event_channel WHERE server_id = ? AND channel_id = ?", [server_id, channel_id]).then(function(result){
      if( result.length > 0 )
        return true
      else
        return false;
    });
  },

  // Get channel id from DB
  getChannel: async function(server_id) {
    return await pool.query("SELECT channel_id FROM event_channel WHERE server_id = ?", [server_id]).then(function(result){
      if( result.length > 0 )
        return result[0].channel_id;
      else
        return null;
    });
  },
}