"use strict";

const request = require("request");
const async = require("async");
const optimist = require("optimist");
const inquirer = require("inquirer");

const _token = optimist.argv.token;


async.auto({
  getToken : (next)=> {
    if (_token) return setImmediate(next, null, _token);

    inquirer.prompt([{ message : "Please enter slack token", type : "input", name : "token" }], (data)=> {
      return next(null, data.token);
    })
  },
  inputs : ['getToken', (next, data)=> {
    console.log("Listing channels ...");

    request({ url : "https://onedio.slack.com/api/rtm.start", qs : { token : data.getToken }, timeout : 10000, json : true },
      (err, resp, data)=> {
        if (err || resp.statusCode != 200) return next(err || new Error("Error occurred while getting IM list"));

        const userMap = new Map(data.users.map(u=>[u.id, u.name]));
        const imsMap = new Map(data.ims.map(m=>[userMap.get(m.user), m.id]));

        inquirer.prompt([{ type : "checkbox", message : "Select channel you want", name : "users", choices : [...userMap.values()] }], (i)=> {
          next(null, { channels : i.users.map(user=> imsMap.get(user)), me : data.self.id });
        });
      })
  }],
  listMessages : ['inputs', (next, data)=> {
    const channels = data.inputs.channels;
    const me = data.inputs.me;

    const listMessages = (options, next) => {
      typeof options == "string" ? options = { channel : options } : "";
      options.messages = options.messages || [];

      request({
        url : "https://slack.com/api/im.history", json : true, timeout : 10000,
        qs : {
          token : data.getToken,
          channel : options.channel,
          count : 1000,
          latest : options.lastTs || 0
        }
      }, (err, resp, data) => {
        if (err || data.error || resp.statusCode != 200) return next(err || new Error(data.error || "IM history error, statusCode", resp.statusCode));

        let messages = data.messages.filter(message => { return message.type == "message" && message.user == me; }).map(message => message.ts);
        let lastTs = messages[messages.length - 1];

        if (!data.messages.length)
          return listMessages({ channel : options.channel, messages : [...messages, ...options.messages], lastTs : lastTs }, next);

        return next(null, { messages : [...messages, ...options.messages], channel : options.channel });
      })
    }

    async.map(channels, listMessages, next)
  }],
  removeMessages : ['listMessages', (next, data)=> {
    const deleteMessage = (options, next) => {
      request({
        url : "https://slack.com/api/chat.delete", timeout : 1000, json : true,
        qs : {
          ts : options.ts,
          channel : options.channel,
          token : data.getToken
        }
      }, (err, resp, data)=> {
        if (err || data.error || resp.statusCode != 200) console.log("Couldn't delete message");
        else console.log("Message deleted successfully");

        return next()
      })
    }

    async.each(data.listMessages, (c, next) => {
      async.eachLimit(c.messages, 5, (ts, next)=> {
        deleteMessage({ ts, channel : c.channel }, next);
      }, next)
    }, next)

  }]
}, (err, data)=> {
  if (err) return console.error("Error:", err);
  console.log("Done");
})
