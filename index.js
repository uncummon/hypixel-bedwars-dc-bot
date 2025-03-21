const fs = require('fs');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const mc = require('minecraft-protocol');
const socks = require('socks').SocksClient;
const fetch = require('node-fetch');

const BOT_TOKEN = 'bot token';
const GUILD_ID = 'discord guild id';
const CHANNEL_ID = 'discord channel id';

const accountsFile = './alts.txt';
const proxiesFile = './proxy.txt';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let accounts = [];
let proxies = [];

try {
  accounts = fs.readFileSync(accountsFile, 'utf8').split('\n').map(line => line.trim()).filter(Boolean);
  proxies = fs.readFileSync(proxiesFile, 'utf8').split('\n').map(line => line.trim()).filter(Boolean);
} catch (error) {
  console.error('Error reading files:', error.message);
  process.exit(1);
}

let bots = [];
let botsInitialized = false;
let shuttingDown = false;

const whitelistFile = './whitelist.json';

if (!fs.existsSync(whitelistFile)) {
  fs.writeFileSync(whitelistFile, JSON.stringify([]));
}

let whitelist = JSON.parse(fs.readFileSync(whitelistFile));

const discordClient = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

let channel = null;

discordClient.once('ready', () => {
  channel = discordClient.channels.cache.get(CHANNEL_ID);
});

function isWhitelisted(userId) {
  return whitelist.includes(userId);
}

async function countdown(channel) {
  for (let i = 3; i >= 0; i--) {
    await channel.send(`${i}...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  channel.send('**Now!**');
}

let connectedBotsCount = 0;
let totalBots = accounts.length;

function createBot(account, proxy, index) {
  const [mcUsername, mcPassword] = account.split(':');
  const [proxyHost, proxyPort, proxyUsername, proxyPassword] = proxy.split(':');
  const mcServerHost = 'mc.hypixel.net';
  const mcServerPort = 25565;

  const client = mc.createClient({
    connect: client => {
      socks.createConnection({
        proxy: {
          host: proxyHost,
          port: parseInt(proxyPort),
          type: 5,
          userId: proxyUsername,
          password: proxyPassword,
        },
        command: 'connect',
        destination: {
          host: mcServerHost,
          port: mcServerPort,
        },
      }, (err, info) => {
        if (err) {
          console.error(`Bot ${index + 1} connection error: ${err.message}`);
          return;
        }
        client.setSocket(info.socket);
        client.emit('connect');
        console.log(`Bot [${index + 1}] connected with IP: ${info.socket.remoteAddress}`);
        channel.send(`Bot [${index + 1}] connected with IP: ${info.socket.remoteAddress}`);
      });
    },
    host: mcServerHost,
    port: mcServerPort,
    username: mcUsername,
    password: mcPassword,
    auth: 'microsoft',
    version: '1.8.9',
  });

  const bot = mineflayer.createBot({ client, hideErrors: true });

  bot.loadPlugin(pathfinder);

  bot.on('spawn', () => {
    console.log(`Bot ${bot.username} connected.`);
    connectedBotsCount++;
    if (connectedBotsCount === totalBots) {
      if (channel) {
        channel.send('**All bots have connected successfully!**');
      } else {
        console.error('Channel is not defined!');
      }
    }
  });

  bot.on('messagestr', async (message) => {
    if (message.includes(`Protect your bed and destroy the enemy beds.`)) {
      bot.setControlState('back', false);
      bot.setControlState('jump', false);
      sleep(500);
      bot.chat('/l');
      console.log('**message detected, bots dced**');
      channel.send('**message detected, bots dced.**');
    }
  });

  bot.on('messagestr', async (message) => {
    if (message.toLowerCase().includes(`has joined`)) {
      sleep(500);
      bot.setControlState('back', true);
      bot.setControlState('jump', true);
    }
  });

  bot.on('messagestr', async (message) => {
    console.log(`Bot ${index + 1} (${bot.username}) received chat: ${message}`);
  });

  bot.on('kicked', (reason) => {
    console.log(`${bot.username}) was kicked: ${reason}`);
    if (channel) channel.send(`${bot.username}) was kicked: ${reason}`);
  });

  bot.on('error', (err) => {
    console.error(`Bot ${index + 1} (${bot.username}) encountered an error: ${err.message}`);
    channel.send(`Bot ${index + 1} (${bot.username}) encountered an error: ${err.message}`);
  });
  return bot;
}

discordClient.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName, user } = interaction;

  if (!isWhitelisted(user.id)) {
    await interaction.reply('You are not authorized to use this command.');
    return;
  }

  if (commandName === 'start') {
    if (botsInitialized) {
      await interaction.reply('**Bots are already running!**');
      return;
    }

    await interaction.reply('**Starting bots...**');

    connectedBotsCount = 0;

    accounts.forEach((account, index) => {
      const proxy = proxies[index];
      const bot = createBot(account, proxy, index);
      bots.push(bot);
    });

    botsInitialized = true;
  }

  if (commandName === 'queue') {
    const mode = interaction.options.getInteger('mode');
    let command;

    switch (mode) {
      case 1:
        command = '/play bedwars_eight_one';
        break;
      case 2:
        command = '/play bedwars_eight_two';
        break;
      case 3:
        command = '/play bedwars_four_three';
        break;
      case 4:
        command = '/play bedwars_four_four';
        break;
      default:
        await interaction.reply('**Invalid mode! Please select 1, 2, 3, or 4.**');
        return;
    }

    await interaction.reply(`**Queueing ${mode}s in 3 seconds...**`);

    await countdown(channel);

    bots.forEach(bot => {
      if (bot) {
        bot.chat(command);
      }
    });
    await interaction.channel.send(`**All bots are queueing ${mode}s!**`);
  }

  if (commandName === 'dc') {
    if (!botsInitialized) {
      await interaction.reply('**No bots are currently running.**');
      return;
    }

    bots.forEach(bot => {
      if (bot) {
        bot.chat('/l');
      }
    });

    await interaction.reply('**All bots have been sent to the lobby!**');
  }

  if (commandName === 'exit') {
    shuttingDown = true;

    bots.forEach(bot => {
      if (bot) {
        bot.quit();
      }
    });

    bots = [];
    botsInitialized = false;

    await interaction.reply('**Bots were shut down.**');
    console.log('Exiting script...');
    process.exit(0);
  }

  if (commandName === 'whitelist_add') {
    const userId = interaction.options.getString('user_id');
    if (whitelist.includes(userId)) {
      await interaction.reply('This user is already whitelisted.');
      return;
    }

    whitelist.push(userId);
    fs.writeFileSync(whitelistFile, JSON.stringify(whitelist, null, 2));
    await interaction.reply(`User ${userId} has been added to the whitelist.`);
  }

  if (commandName === 'whitelist_remove') {
    const userId = interaction.options.getString('user_id');
    if (!whitelist.includes(userId)) {
      await interaction.reply('This user is not in the whitelist.');
      return;
    }

    whitelist = whitelist.filter(id => id !== userId);
    fs.writeFileSync(whitelistFile, JSON.stringify(whitelist, null, 2));
    await interaction.reply(`User ${userId} has been removed from the whitelist.`);
  }

  if (commandName === 'stop') {
    if (!botsInitialized) {
      await interaction.reply('**No bots are currently running.**');
      return;
    }

    bots.forEach(bot => {
      if (bot) {
        bot.quit();
      }
    });

    bots = [];
    botsInitialized = false;

    await interaction.reply('**All bots have been stopped.**');
  }
});

discordClient.login(BOT_TOKEN);

discordClient.on('ready', async () => {
  const data = [
    {
      name: 'start',
      description: 'Starts all bots.',
    },
    {
      name: 'queue',
      description: 'Queues the bot into a specified Bedwars game mode',
      options: [
        {
          name: 'mode',
          type: 4,
          description: 'Game mode (1: Solo, 2: Doubles, 3: 3v3v3v3, 4: 4v4v4v4)',
          required: true,
        },
      ],
    },
    {
      name: 'dc',
      description: 'Disconnects the bots.',
    },
    {
      name: 'exit',
      description: 'Shuts down all bots and exits the script.',
    },
    {
      name: 'whitelist_add',
      description: 'Add a user to the whitelist.',
      options: [
        {
          name: 'user_id',
          type: 3,
          description: 'User ID to whitelist',
          required: true,
        },
      ],
    },
    {
      name: 'whitelist_remove',
      description: 'Remove a user from the whitelist.',
      options: [
        {
          name: 'user_id',
          type: 3,
          description: 'User ID to remove',
          required: true,
        },
      ],
    },
    {
      name: 'stop',
      description: 'Stop all bots.',
    },
  ];

  const guild = discordClient.guilds.cache.get(GUILD_ID);

  if (guild) {
    await guild.commands.set(data);
    console.log('\n\n  bot online');
  } else {
    console.log('Guild not found.');
  }
});