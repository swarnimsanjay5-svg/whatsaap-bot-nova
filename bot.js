const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        handleSIGINT: false,
        protocolTimeout: 300000,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--no-first-run',
            '--no-zygote',
            '--disable-extensions',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36'
        ]
    }
});

const DB_FILE = './database.json';
let db = {};
let pendingBattles = {};       // { targetId: { challengerId, challengerName, defenderName } }
let activeBattles = {};        // { battleId: { p1, p2, p1Id, p2Id, turn, log, wildMode, wildPokemon } }
let wildPokemonState = {};     // { chatId: { pokemon, spawnTime } }
let messageCounters = {};      // { chatId: count }

// ── MOD NUMBERS ──────────────────────────────────────────────────────────────
const MOD_NUMBERS = ['919434241260@c.us', '919002371368@c.us'];

// ── POKÉBALL SHOP ─────────────────────────────────────────────────────────────
const POKEBALL_SHOP = {
    pokeball:    { name: 'Pokéball',       price: 500,    catchBonus: 0,   emoji: '🔴', desc: 'Standard catch tool' },
    greatball:   { name: 'Great Ball',     price: 2000,   catchBonus: 15,  emoji: '🔵', desc: '+15% catch rate' },
    ultraball:   { name: 'Ultra Ball',     price: 5000,   catchBonus: 30,  emoji: '⚫', desc: '+30% catch rate' },
    masterball:  { name: 'Master Ball',    price: 500000, catchBonus: 100, emoji: '🟣', desc: '100% guaranteed catch!' },
    heavyball:   { name: 'Heavy Ball',     price: 8000,   catchBonus: 20,  emoji: '⚙️', desc: 'Best vs large Pokémon' },
    lureball:    { name: 'Lure Ball',      price: 3000,   catchBonus: 25,  emoji: '🎣', desc: 'Extra effective on fish Pokémon' },
};

// ── FOOD SHOP ─────────────────────────────────────────────────────────────────
const FOOD_SHOP = {
    chicken:    { name: 'Roasted Chicken',   price: 400,      heal: 25,   energy: 25,   emoji: '🍗',   desc: 'Restores +25 HP', isAlcohol: false, isToxic: false },
    milkshake:  { name: 'Thick Milkshake',   price: 700,      heal: 45,   energy: 45,   emoji: '🥤',   desc: 'Restores +45 HP', isAlcohol: false, isToxic: false },
    coke:       { name: 'Chilled Coke',      price: 100,      heal: 65,   energy: 65,   emoji: '🥤',   desc: 'Restores +65 HP', isAlcohol: false, isToxic: false },
    protein:    { name: 'Protein Bar',       price: 2500,     heal: 100,  energy: 100,  emoji: '🍫',   desc: 'Fully restores HP', isAlcohol: false, isToxic: false },
    mystery:    { name: 'Mystery Drink',     price: 5000,     heal: 100,  energy: 100,  emoji: '🧪',   desc: 'Full heal + +20 XP!', isAlcohol: false, isToxic: false },
    mrbeast:    { name: 'MrBeast Chocolate', price: 10000000, heal: 999,  energy: 999,  emoji: '🍫✨', desc: 'PERMANENT +50 Max HP & +25 ATK forever!', isAlcohol: false, isToxic: false },
    pizza:      { name: 'Mega Pizza',        price: 1200,     heal: 80,   energy: 80,   emoji: '🍕',   desc: 'Restores +80 HP — cheesy goodness', isAlcohol: false, isToxic: false },
    sushi:      { name: 'Premium Sushi',     price: 3000,     heal: 90,   energy: 90,   emoji: '🍣',   desc: 'Restores +90 HP + +10 XP boost', isAlcohol: false, isToxic: false, xpBonus: 10 },
    energy:     { name: 'Energy Drink',      price: 800,      heal: 50,   energy: 50,   emoji: '⚡',   desc: 'Restores +50 HP + +5 ATK for next battle', isAlcohol: false, isToxic: false, atkBuff: 5 },
    // ── Alcohol & Funny items ──
    rum:        { name: 'Dark Rum 🍾',       price: 1500,     heal: 40,   energy: 40,   emoji: '🍾',   desc: '1-3 uses: +40 HP & +10 ATK buff. After 3: TOXIC for 10 mins!', isAlcohol: true, atkBuff: 10 },
    whiskey:    { name: 'Old Whiskey 🥃',    price: 2000,     heal: 50,   energy: 50,   emoji: '🥃',   desc: '1-3 uses: +50 HP & +15 ATK buff. After 3: TOXIC for 12 mins!', isAlcohol: true, atkBuff: 15 },
    cigar:      { name: 'Premium Cigar 🚬',  price: 500,      heal: 20,   energy: 20,   emoji: '🚬',   desc: '1-3 uses: +20 HP & +5 ATK swagger. After 3: TOXIC for 10 mins!', isAlcohol: true, atkBuff: 5 },
    cigarette:  { name: 'Cigarette Pack 🚬', price: 200,      heal: 10,   energy: 10,   emoji: '🚬',   desc: '1-3 uses: +10 HP & +3 ATK. After 3: TOXIC for 15 mins!', isAlcohol: true, atkBuff: 3 },
    beer:       { name: 'Cold Beer 🍺',      price: 600,      heal: 30,   energy: 30,   emoji: '🍺',   desc: '1-3 uses: +30 HP & +8 ATK. After 3: TOXIC for 10 mins!', isAlcohol: true, atkBuff: 8 },
};

// ── POKÉMON MOVES ─────────────────────────────────────────────────────────────
const POKEMON_MOVES = {
    pikachu:    [
        { name: 'Thunderbolt',   damage: [45, 65], emoji: '⚡', special: false },
        { name: 'Thunder',       damage: [60, 90], emoji: '🌩️', special: true  },
        { name: 'Quick Attack',  damage: [20, 35], emoji: '💨', special: false },
        { name: 'Volt Tackle',   damage: [80, 110],emoji: '⚡💥',special: true  },
    ],
    bulbasaur:  [
        { name: 'Vine Whip',     damage: [35, 50], emoji: '🌿', special: false },
        { name: 'Solar Beam',    damage: [65, 90], emoji: '☀️', special: true  },
        { name: 'Razor Leaf',    damage: [40, 60], emoji: '🍃', special: false },
        { name: 'Poison Powder', damage: [25, 40], emoji: '☠️', special: false },
    ],
    charmander: [
        { name: 'Ember',         damage: [35, 55], emoji: '🔥', special: false },
        { name: 'Fire Spin',     damage: [55, 80], emoji: '🌀🔥',special: true  },
        { name: 'Scratch',       damage: [20, 35], emoji: '✋', special: false },
        { name: 'Flamethrower',  damage: [60, 85], emoji: '🔥💨',special: true  },
    ],
    squirtle:   [
        { name: 'Water Gun',     damage: [35, 50], emoji: '💧', special: false },
        { name: 'Hydro Pump',    damage: [65, 95], emoji: '🌊', special: true  },
        { name: 'Tackle',        damage: [20, 30], emoji: '💪', special: false },
        { name: 'Bubble Beam',   damage: [45, 65], emoji: '🫧', special: false },
    ],
    charizard:  [
        { name: 'Flamethrower',  damage: [70, 95], emoji: '🔥', special: false },
        { name: 'Fire Blast',    damage: [90, 130],emoji: '💥🔥',special: true  },
        { name: 'Dragon Claw',   damage: [75, 100],emoji: '🐉', special: false },
        { name: 'Inferno',       damage: [100,140],emoji: '☄️', special: true  },
    ],
    blastoise:  [
        { name: 'Hydro Pump',    damage: [75, 100],emoji: '🌊', special: true  },
        { name: 'Water Cannon',  damage: [85, 115],emoji: '💦', special: true  },
        { name: 'Skull Bash',    damage: [60, 80], emoji: '💀', special: false },
        { name: 'Ice Beam',      damage: [65, 90], emoji: '🧊', special: false },
    ],
    venusaur:   [
        { name: 'Solar Beam',    damage: [80, 110],emoji: '☀️', special: true  },
        { name: 'Petal Dance',   damage: [70, 95], emoji: '🌸', special: false },
        { name: 'Earthquake',    damage: [85, 120],emoji: '🌍', special: true  },
        { name: 'Sludge Bomb',   damage: [65, 85], emoji: '☠️', special: false },
    ],
    greninja:   [
        { name: 'Water Shuriken',damage: [80, 110],emoji: '🥷💧',special: true  },
        { name: 'Night Slash',   damage: [70, 95], emoji: '🌑', special: false },
        { name: 'Dark Pulse',    damage: [75, 100],emoji: '🔮', special: false },
        { name: 'Hydro Vortex',  damage: [100,135],emoji: '🌀🌊',special: true  },
    ],
    gengar:     [
        { name: 'Shadow Ball',   damage: [80, 110],emoji: '👻', special: true  },
        { name: 'Dream Eater',   damage: [90, 120],emoji: '💤', special: true  },
        { name: 'Hex',           damage: [65, 85], emoji: '🔮', special: false },
        { name: 'Night Shade',   damage: [70, 95], emoji: '🌑', special: false },
    ],
    gyarados:   [
        { name: 'Hyper Beam',    damage: [100,140],emoji: '💥', special: true  },
        { name: 'Dragon Rage',   damage: [80, 110],emoji: '🐉', special: false },
        { name: 'Hydro Pump',    damage: [85, 115],emoji: '🌊', special: true  },
        { name: 'Crunch',        damage: [70, 95], emoji: '🦷', special: false },
    ],
    garchomp:   [
        { name: 'Dragon Claw',   damage: [90, 120],emoji: '🦈🐉',special: false },
        { name: 'Earthquake',    damage: [95, 130],emoji: '🌍', special: true  },
        { name: 'Sand Tomb',     damage: [65, 85], emoji: '🏜️', special: false },
        { name: 'Outrage',       damage: [110,150],emoji: '💢🐉',special: true  },
    ],
    lucario:    [
        { name: 'Aura Sphere',   damage: [95, 130],emoji: '✨🔵',special: true  },
        { name: 'Close Combat',  damage: [100,135],emoji: '👊', special: false },
        { name: 'Bone Rush',     damage: [75, 100],emoji: '🦴', special: false },
        { name: 'Flash Cannon',  damage: [85, 115],emoji: '💡', special: true  },
    ],
    mew:        [
        { name: 'Psychic',       damage: [90, 120],emoji: '🌀', special: true  },
        { name: 'Ancient Power', damage: [80, 110],emoji: '🪨', special: false },
        { name: 'Metronome',     damage: [70, 130],emoji: '🎵', special: true  },
        { name: 'Aura Sphere',   damage: [95, 125],emoji: '✨', special: true  },
    ],
    darkrai:    [
        { name: 'Dark Void',     damage: [100,140],emoji: '🌑', special: true  },
        { name: 'Shadow Ball',   damage: [85, 115],emoji: '👻', special: false },
        { name: 'Nightmare',     damage: [90, 125],emoji: '💤', special: true  },
        { name: 'Dark Pulse',    damage: [80, 110],emoji: '🔮', special: false },
    ],
    mewtwo:     [
        { name: 'Psystrike',     damage: [110,150],emoji: '🌌', special: true  },
        { name: 'Psychic',       damage: [100,135],emoji: '🌀', special: true  },
        { name: 'Shadow Ball',   damage: [90, 120],emoji: '👻', special: false },
        { name: 'Hyper Beam',    damage: [120,160],emoji: '💥', special: true  },
    ],
    rayquaza:   [
        { name: 'Dragon Ascent', damage: [120,165],emoji: '🟢🐉',special: true  },
        { name: 'Hyper Beam',    damage: [115,155],emoji: '💥', special: true  },
        { name: 'Outrage',       damage: [105,140],emoji: '💢', special: false },
        { name: 'Air Lock Slam', damage: [100,135],emoji: '🌪️', special: false },
    ],
    lugia:      [
        { name: 'Aeroblast',     damage: [115,155],emoji: '🦅💨',special: true  },
        { name: 'Hydro Pump',    damage: [90, 120],emoji: '🌊', special: false },
        { name: 'Extrasensory',  damage: [95, 130],emoji: '🌀', special: true  },
        { name: 'Whirlwind',     damage: [80, 110],emoji: '🌪️', special: false },
    ],
    arceus:     [
        { name: 'Judgement',     damage: [130,175],emoji: '👑⚡',special: true  },
        { name: 'Hyper Voice',   damage: [110,150],emoji: '📣', special: false },
        { name: 'Earth Power',   damage: [115,155],emoji: '🌍', special: true  },
        { name: 'Cosmic Power',  damage: [100,140],emoji: '🌌', special: false },
    ],
};

// Default moves for wild/unconfigured Pokémon
const DEFAULT_MOVES = [
    { name: 'Tackle',    damage: [15, 30], emoji: '💪', special: false },
    { name: 'Scratch',   damage: [20, 35], emoji: '✋', special: false },
    { name: 'Growl',     damage: [10, 20], emoji: '😾', special: false },
    { name: 'Quick Hit', damage: [25, 40], emoji: '💨', special: false },
];

function getMovesForPokemon(pokeName) {
    return POKEMON_MOVES[pokeName.toLowerCase()] || DEFAULT_MOVES;
}

// ── WILD POKÉMON POOL ─────────────────────────────────────────────────────────
const WILD_POKEMON_POOL = [
    { name: 'Rattata',   hp: 30,  atk: 56,  emoji: '🐭', dexId: 19,  rarity: 'Weak' },
    { name: 'Pidgey',    hp: 40,  atk: 45,  emoji: '🐦', dexId: 16,  rarity: 'Weak' },
    { name: 'Meowth',    hp: 40,  atk: 45,  emoji: '🐱', dexId: 52,  rarity: 'Weak' },
    { name: 'Psyduck',   hp: 50,  atk: 52,  emoji: '🦆', dexId: 54,  rarity: 'Common' },
    { name: 'Growlithe', hp: 55,  atk: 70,  emoji: '🐕', dexId: 58,  rarity: 'Common' },
    { name: 'Abra',      hp: 25,  atk: 20,  emoji: '🔮', dexId: 63,  rarity: 'Common' },
    { name: 'Machop',    hp: 70,  atk: 80,  emoji: '💪', dexId: 66,  rarity: 'Common' },
    { name: 'Haunter',   hp: 45,  atk: 50,  emoji: '👻', dexId: 93,  rarity: 'Rare' },
    { name: 'Scyther',   hp: 70,  atk: 110, emoji: '🦗', dexId: 123, rarity: 'Rare' },
    { name: 'Eevee',     hp: 55,  atk: 55,  emoji: '🦊', dexId: 133, rarity: 'Rare' },
    { name: 'Snorlax',   hp: 160, atk: 110, emoji: '😴', dexId: 143, rarity: 'Epic' },
    { name: 'Dragonite', hp: 91,  atk: 134, emoji: '🐲', dexId: 149, rarity: 'Epic' },
    { name: 'Alakazam',  hp: 55,  atk: 50,  emoji: '🥄', dexId: 65,  rarity: 'Epic' },
    { name: 'Articuno',  hp: 90,  atk: 85,  emoji: '🧊', dexId: 144, rarity: 'Legendary' },
    { name: 'Zapdos',    hp: 90,  atk: 90,  emoji: '⚡', dexId: 145, rarity: 'Legendary' },
    { name: 'Moltres',   hp: 90,  atk: 100, emoji: '🔥', dexId: 146, rarity: 'Legendary' },
];

// ── FISH SELL PRICES ──────────────────────────────────────────────────────────
const FISH_SELL_PRICES = {
    fish:       { key: 'fish',      price: 200,  name: 'Standard Minnow Fish', emoji: '🐟' },
    salmon:     { key: 'salmon',    price: 800,  name: 'Premium Salmon',       emoji: '🐟' },
    goldenfish: { key: 'goldenFish',price: 5000, name: 'Legendary Golden Fish', emoji: '✨🐟' },
    golden:     { key: 'goldenFish',price: 5000, name: 'Legendary Golden Fish', emoji: '✨🐟' },
};

// ── COOLDOWNS (seconds) ───────────────────────────────────────────────────────
const CD_DIG = 60, CD_FISH = 45, CD_CASINO = 180, CD_SLOTS = 45,
      CD_DB = 30, CD_ROULETTE = 40, CD_COINFLIP = 30, CD_CHEAT = 600, CD_ROB = 300;

const AVAILABLE_BAGS = ['Skybag', 'Safari Bag', 'Aristocrat Bag', 'Gucci Bag 💼', 'American Tourister'];

const ROAST_MESSAGES = [
    "Look at this script kiddie trying to run dev cheats in a group! Go execute `.dig` and work hard for once. 🤡",
    "Bro really thought he could hack his way into wealth while everyone was watching. Absolute clown energy! 🧠❌",
    "Nice try, master hacker! Next time try executing your masterplans in my DMs, not in public. How embarrassing! 😂"
];

// ── CATCH GIF URL ─────────────────────────────────────────────────────────────
const POKEBALL_GIF_URL = 'https://media.tenor.com/5n7JF3bVDfYAAAAC/pokeball-throw.gif';

// ── DB HELPERS ────────────────────────────────────────────────────────────────
if (fs.existsSync(DB_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { db = {}; }
}
if (!db._config) db._config = { botActive: true };

function saveDB() {
    try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
    catch (err) { console.error("DB save error:", err); }
}

function initUser(userId) {
    if (!db[userId]) db[userId] = {};
    const u = db[userId];
    if (u.wallet === undefined)       u.wallet = 550000;
    if (u.bank === undefined)         u.bank = 0;
    if (u.maxCapacity === undefined)  u.maxCapacity = 7700000;
    if (u.lastDig === undefined)      u.lastDig = 0;
    if (u.lastFish === undefined)     u.lastFish = 0;
    if (u.lastCasino === undefined)   u.lastCasino = 0;
    if (u.lastSlots === undefined)    u.lastSlots = 0;
    if (u.lastDb === undefined)       u.lastDb = 0;
    if (u.lastRoulette === undefined) u.lastRoulette = 0;
    if (u.lastCoinflip === undefined) u.lastCoinflip = 0;
    if (u.lastCheat === undefined)    u.lastCheat = 0;
    if (u.lastDaily === undefined)    u.lastDaily = 0;
    if (u.dailyStreak === undefined)  u.dailyStreak = 0;
    if (u.lastRob === undefined)      u.lastRob = 0;
    if (u.dailyDbCount === undefined) u.dailyDbCount = 0;
    if (u.lastLimitReset === undefined) u.lastLimitReset = Date.now();
    if (u.inventory === undefined)    u.inventory = {};
    const inv = u.inventory;
    if (inv.shovel === undefined)       inv.shovel = 1;
    if (inv.fishingRod === undefined)   inv.fishingRod = 1;
    if (inv.pokeball === undefined)     inv.pokeball = 5;
    if (inv.greatball === undefined)    inv.greatball = 0;
    if (inv.ultraball === undefined)    inv.ultraball = 0;
    if (inv.masterball === undefined)   inv.masterball = 0;
    if (inv.heavyball === undefined)    inv.heavyball = 0;
    if (inv.lureball === undefined)     inv.lureball = 0;
    if (inv.assignedBag === undefined)  inv.assignedBag = AVAILABLE_BAGS[Math.floor(Math.random() * AVAILABLE_BAGS.length)];
    if (inv.fish === undefined)         inv.fish = 0;
    if (inv.salmon === undefined)       inv.salmon = 0;
    if (inv.goldenFish === undefined)   inv.goldenFish = 0;
    // Food items
    for (let key of Object.keys(FOOD_SHOP)) {
        if (inv[key] === undefined) inv[key] = 0;
    }
    if (u.pokemon === undefined) u.pokemon = [];
    // Toxicity tracker per pokemon: { pokemonName: { alcoholCount, cigarCount, toxicUntil } }
    if (u.toxicity === undefined) u.toxicity = {};
    // ATK buffs from food (temporary, per battle): stored but reset after use
    if (u.atkBuff === undefined) u.atkBuff = 0;
}

function checkDailyReset(userId) {
    const now = Date.now();
    if (now - db[userId].lastLimitReset > 86400000) {
        db[userId].dailyDbCount = 0;
        db[userId].lastLimitReset = now;
        saveDB();
    }
}

function makeProgressBar(current, max) {
    const total = 8;
    const filled = Math.max(0, Math.min(total, Math.round((current / max) * total)));
    return '🟩'.repeat(filled) + '⬜'.repeat(total - filled);
}

function pickWildPokemon() {
    const roll = Math.random() * 100;
    let pool;
    if (roll <= 40)      pool = WILD_POKEMON_POOL.filter(p => p.rarity === 'Weak');
    else if (roll <= 70) pool = WILD_POKEMON_POOL.filter(p => p.rarity === 'Common');
    else if (roll <= 88) pool = WILD_POKEMON_POOL.filter(p => p.rarity === 'Rare');
    else if (roll <= 97) pool = WILD_POKEMON_POOL.filter(p => p.rarity === 'Epic');
    else                 pool = WILD_POKEMON_POOL.filter(p => p.rarity === 'Legendary');
    return { ...pool[Math.floor(Math.random() * pool.length)] };
}

function checkWildSpawn(chatId) {
    if (!messageCounters[chatId]) messageCounters[chatId] = 0;
    messageCounters[chatId]++;
    const threshold = Math.floor(Math.random() * 11) + 15;
    if (messageCounters[chatId] >= threshold && !wildPokemonState[chatId]) {
        messageCounters[chatId] = 0;
        return true;
    }
    return false;
}

function generateBattleId() {
    return 'BT' + Date.now().toString(36).toUpperCase();
}

function isToxic(userId, pokeName) {
    const tox = db[userId]?.toxicity?.[pokeName.toLowerCase()];
    if (!tox) return false;
    return tox.toxicUntil && Date.now() < tox.toxicUntil;
}

function getToxicInfo(userId, pokeName) {
    return db[userId]?.toxicity?.[pokeName.toLowerCase()] || { alcoholCount: 0, cigarCount: 0, toxicUntil: 0 };
}

// ── CLIENT EVENTS ─────────────────────────────────────────────────────────────
client.on('qr', qr => { qrcode.generate(qr, { small: true }); console.log('👉 Scan QR:'); });
client.on('ready', () => console.log('🚀 BOT ONLINE — ALL SYSTEMS GO'));

// ── MAIN MESSAGE HANDLER ──────────────────────────────────────────────────────
client.on('message_create', async msg => {
    try {
        const body = msg.body ? msg.body.trim() : '';
        const senderId = msg.author || msg.from;
        if (!body) return;

        const chatObj = await msg.getChat();
        const isGroupChat = chatObj.isGroup;

        let isMod = false;
        if (msg.fromMe) { isMod = true; }
        else {
            try {
                if (isGroupChat && chatObj.participants) {
                    isMod = chatObj.participants.some(p =>
                        p.id._serialized === senderId && (p.isAdmin || p.isSuperAdmin));
                } else if (!isGroupChat) { isMod = true; }
            } catch (_) {}
        }

        // ── Handle active battle move replies ────────────────────────────────
        // Players reply with a move name like "Thunderbolt" or "1" (move index)
        const lowerBody = body.toLowerCase().trim();

        // Check if this user is in an active battle and replying with a move
        for (const [battleId, battle] of Object.entries(activeBattles)) {
            const isP1Turn = battle.turn === 'p1' && senderId === battle.p1Id;
            const isP2Turn = battle.turn === 'p2' && senderId === battle.p2Id;
            if (!isP1Turn && !isP2Turn) continue;

            const myPoke   = isP1Turn ? battle.p1 : battle.p2;
            const oppPoke  = isP1Turn ? battle.p2 : battle.p1;
            const myId     = senderId;
            const oppId    = isP1Turn ? battle.p2Id : battle.p1Id;
            const myName   = myId.split('@')[0];
            const oppName  = oppId.split('@')[0];

            const moves = getMovesForPokemon(myPoke.name);
            let chosenMove = null;

            // match by number (1-4) or name
            const numMatch = parseInt(lowerBody);
            if (!isNaN(numMatch) && numMatch >= 1 && numMatch <= moves.length) {
                chosenMove = moves[numMatch - 1];
            } else {
                chosenMove = moves.find(m => m.name.toLowerCase() === lowerBody);
            }
            if (!chosenMove) break; // not a valid move, ignore

            // Calculate damage
            const dmg = Math.floor(Math.random() * (chosenMove.damage[1] - chosenMove.damage[0] + 1)) + chosenMove.damage[0];
            oppPoke.hp = Math.max(0, oppPoke.hp - dmg);

            let moveMsg = `⚔️ *${myPoke.emoji} ${myPoke.name}* used *${chosenMove.emoji} ${chosenMove.name}*!\n` +
                          `💥 Dealt *${dmg} damage* to ${oppPoke.emoji} ${oppPoke.name}!\n` +
                          `❤️ ${oppPoke.name} HP: ${makeProgressBar(oppPoke.hp, oppPoke.maxHp)} (${oppPoke.hp}/${oppPoke.maxHp})\n`;

            if (oppPoke.hp <= 0) {
                // Battle over
                delete activeBattles[battleId];

                if (battle.wildMode) {
                    // Wild Pokémon defeated — chance to catch
                    const wild = battle.wildPokemon;
                    moveMsg += `\n🏆 *${myPoke.name} wins!* Wild ${wild.emoji} ${wild.name} is weakened!\n\n`;
                    moveMsg += `🎯 Use *.throwball [balltype]* to try catching it!\n` +
                               `_(e.g. \`.throwball pokeball\` or \`.throwball ultraball\`)_\n` +
                               `⚠️ Wild Pokémon flees in 30 seconds if not caught!`;
                    wildPokemonState[chatObj.id._serialized] = {
                        pokemon: { ...wild, hp: 1 },
                        spawnTime: Date.now(),
                        weakened: true,
                        battleWinner: myId
                    };
                    // Auto-flee after 30s
                    setTimeout(() => {
                        const cid = chatObj.id._serialized;
                        if (wildPokemonState[cid]?.weakened) {
                            delete wildPokemonState[cid];
                            chatObj.sendMessage(`💨 The weakened ${wild.emoji} ${wild.name} recovered and fled into the wild!`).catch(() => {});
                        }
                    }, 30000);
                } else {
                    // PvP battle over
                    const winnerId  = myId;
                    const loserId   = oppId;
                    const prize = 50000;
                    initUser(winnerId); initUser(loserId);

                    // Sync HP back to DB
                    const updatePokeHp = (uid, poke) => {
                        const party = db[uid].pokemon || [];
                        const found = party.find(p => p.name.toLowerCase() === poke.name.toLowerCase());
                        if (found) { found.hp = poke.hp; }
                    };
                    updatePokeHp(myId, myPoke);
                    updatePokeHp(oppId, oppPoke);
                    db[winnerId].wallet += prize;
                    saveDB();
                    moveMsg += `\n🏆 *${myPoke.emoji} ${myPoke.name}* won the battle!\n` +
                               `💰 *Prize: +$${prize.toLocaleString()}* awarded to @${myName}!\n\n` +
                               `💡 Heal your Pokémon with \`.feed\` before the next battle.`;
                }
                return chatObj.sendMessage(moveMsg, { mentions: [myId, oppId] }).catch(() => {});
            }

            // Switch turn
            battle.turn = isP1Turn ? 'p2' : 'p1';
            const nextId   = isP1Turn ? battle.p2Id : battle.p1Id;
            const nextPoke = isP1Turn ? battle.p2 : battle.p1;
            const nextMoves = getMovesForPokemon(nextPoke.name);
            moveMsg += `\n⏳ @${nextId.split('@')[0]}'s turn! *${nextPoke.emoji} ${nextPoke.name}*'s moves:\n`;
            nextMoves.forEach((m, i) => { moveMsg += `${i+1}. ${m.emoji} *${m.name}* (${m.damage[0]}-${m.damage[1]} dmg)${m.special ? ' ✨' : ''}\n`; });
            moveMsg += `\nReply with move number or name!`;
            return chatObj.sendMessage(moveMsg, { mentions: [nextId] }).catch(() => {});
        }

        // Only process dot-commands from here
        if (!body.startsWith('.')) return;
        if (!db._config.botActive && body !== '.bot on' && body !== '.bot off') return;

        const args = body.split(' ').filter(a => a !== '');
        const command = args[0].toLowerCase();

        // ── WILD SPAWN CHECK ─────────────────────────────────────────────────
        if (isGroupChat && command !== '.catch' && command !== '.throwball') {
            if (checkWildSpawn(chatObj.id._serialized)) {
                const wild = pickWildPokemon();
                const cid = chatObj.id._serialized;
                wildPokemonState[cid] = { pokemon: { ...wild, currentHp: wild.hp }, spawnTime: Date.now(), weakened: false };

                const spawnCard = `🌿 *A WILD POKÉMON APPEARED IN THE TALL GRASS!* 🌿\n` +
                                  `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
                                  `${wild.emoji} *${wild.name}* [${wild.rarity}] appeared!\n` +
                                  `❤️ HP: ${wild.hp} | ⚔️ ATK: ${wild.atk}\n\n` +
                                  `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
                                  `🥊 Type *.catch* to battle it!\n` +
                                  `_(Flees in 3 minutes if nobody challenges!)_`;
                try {
                    const artUrl = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${wild.dexId}.png`;
                    const media = await MessageMedia.fromUrl(artUrl);
                    await chatObj.sendMessage(media, { caption: spawnCard });
                } catch (_) {
                    await chatObj.sendMessage(spawnCard);
                }
                setTimeout(() => {
                    if (wildPokemonState[cid] && !wildPokemonState[cid].weakened) {
                        delete wildPokemonState[cid];
                        chatObj.sendMessage(`💨 *Wild ${wild.emoji} ${wild.name} fled into the bushes!* Nobody was brave enough.`).catch(() => {});
                    }
                }, 3 * 60 * 1000);
            }
        }

        // ── .mods ─────────────────────────────────────────────────────────────
        if (command === '.mods') {
            const mod1 = MOD_NUMBERS[0];
            const mod2 = MOD_NUMBERS[1];
            const requester = senderId.split('@')[0];
            const modMsg = `📢 *MOD ALERT — HELP NEEDED!* 📢\n` +
                           `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
                           `⚠️ @${requester} from this group needs assistance!\n\n` +
                           `👮 Tagging Moderators:\n` +
                           `• @${mod1.split('@')[0]}\n` +
                           `• @${mod2.split('@')[0]}\n\n` +
                           `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
                           `_Please attend to the group as soon as possible!_`;
            return chatObj.sendMessage(modMsg, { mentions: [senderId, mod1, mod2] }).catch(() => {});
        }

        // ── .gamble ───────────────────────────────────────────────────────────
        if (command === '.gamble') {
            return msg.reply(
                `🎰 *CASINO DISTRICT — GAMBLING GUIDE* 🎰\n` +
                `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
                `🎰 *.casino [bet]* — Slot machine. Win or lose your bet. (CD: 3 min)\n\n` +
                `🎰 *.slots [bet]* — 3-reel slots. Match 3 = 4x payout! (CD: 45s)\n\n` +
                `🎡 *.roulette [red/black/green] [bet]* — Spin the wheel. Green pays 14x! (CD: 40s)\n\n` +
                `⚖️ *.db [bet]* or *.double [bet]* — Double or Nothing! 48% win chance. Max 15/day. (CD: 30s)\n\n` +
                `🪙 *.cf [heads/tails] [bet]* or *.coinflip* — Classic coin flip. (CD: 30s)\n\n` +
                `🦹 *.rob [@user]* — Attempt to rob another player's wallet! (CD: 5 min, groups only)\n\n` +
                `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
                `💡 _All games are luck-based. Gamble responsibly!_`
            );
        }

        // ── DEV CHEATS ────────────────────────────────────────────────────────
        if (command === '.jatha69' || command === '.boojho' || command === '.xxx') {
            if (!isMod) return msg.reply('❌ System privileges denied.');
            if (isGroupChat) {
                const roast = ROAST_MESSAGES[Math.floor(Math.random() * ROAST_MESSAGES.length)];
                return chatObj.sendMessage(`🔥 @${senderId.split('@')[0]} ${roast}`, { mentions: [senderId] }).catch(() => {});
            }
            initUser(senderId);
            const now = Date.now();
            if ((now - db[senderId].lastCheat) / 1000 < CD_CHEAT) {
                let left = Math.ceil(CD_CHEAT - (now - db[senderId].lastCheat) / 1000);
                return msg.reply(`⏳ Dev engine on cooldown. Wait *${Math.floor(left/60)}m ${left%60}s*.`);
            }
            let amt = command === '.jatha69' ? 1000000 : command === '.boojho' ? 2000000 : 50000000;
            db[senderId].lastCheat = now;
            db[senderId].wallet += amt;
            saveDB();
            return msg.reply(`⚙️ Dev Vault Injection: *+$${amt.toLocaleString()}* loaded.`);
        }

        if (command === '.addmoney') {
            if (!isMod) return msg.reply('❌ Privileged engine command locked.');
            let targetUser = msg.hasQuotedMsg ? (await msg.getQuotedMessage()).author : (msg.mentionedIds[0] || senderId);
            let amtStr = msg.hasQuotedMsg ? args[1] : (msg.mentionedIds[0] ? args[2] : args[1]);
            let amount = parseInt(amtStr);
            if (isNaN(amount)) return msg.reply('❌ Syntax: `.addmoney [amount]`');
            initUser(targetUser); db[targetUser].wallet += amount; saveDB();
            return msg.reply(`💰 Injected *+$${amount.toLocaleString()}* to @${targetUser.split('@')[0]}`);
        }

        if (command === '.bot') {
            if (!isMod) return msg.reply('❌ Denied.');
            const action = args[1] ? args[1].toLowerCase() : '';
            if (action === 'off') { db._config.botActive = false; saveDB(); return msg.reply('🔴 Bot deactivated.'); }
            else if (action === 'on') { db._config.botActive = true; saveDB(); return msg.reply('🟢 Bot active.'); }
        }

        if (!db._config.botActive) return;

        // ── PROFILE / BALANCE ─────────────────────────────────────────────────
        if (command === '.bal' || command === '.p' || command === '.profile') {
            let target = msg.hasQuotedMsg ? (await msg.getQuotedMessage()).author : (msg.mentionedIds[0] || senderId);
            initUser(target); const u = db[target];
            return msg.reply(
                `💳 *FEDERAL ASSET MONITOR* 📝\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
                `💰 *Wallet:* 〔 $${u.wallet.toLocaleString()} 〕\n` +
                `🏦 *Bank:* 〔 $${u.bank.toLocaleString()} 〕\n\n` +
                `💎 *Net Wealth:* 〔 $${(u.wallet + u.bank).toLocaleString()} 〕\n` +
                `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
            );
        }

        // ── .dig ──────────────────────────────────────────────────────────────
        if (command === '.dig') {
            initUser(senderId); const now = Date.now();
            if ((now - db[senderId].lastDig) / 1000 < CD_DIG) {
                let left = Math.ceil(CD_DIG - (now - db[senderId].lastDig) / 1000);
                return msg.reply(`⏳ Your hands are tired! Wait *${left}s*.`);
            }
            db[senderId].lastDig = now;
            const chance = Math.random() * 100;
            if (chance <= 15) {
                let loss = Math.min(Math.floor(Math.random() * 800) + 500, db[senderId].wallet);
                db[senderId].wallet -= loss; saveDB();
                return msg.reply(`🪦 A zombie jumped out and stole *-$${loss.toLocaleString()}*! 🧟‍♂️`);
            } else if (chance <= 50) {
                saveDB();
                return msg.reply(`⛏️ You spent an hour digging and found only worms. What a waste.`);
            } else {
                let win = Math.floor(Math.random() * 1200) + 600;
                db[senderId].wallet += win; saveDB();
                return msg.reply(`⛏️ Found a buried lockbox! Gained: *+$${win.toLocaleString()}*`);
            }
        }

        // ── .fish ─────────────────────────────────────────────────────────────
        if (command === '.fish') {
            initUser(senderId); const now = Date.now();
            if ((now - db[senderId].lastFish) / 1000 < CD_FISH) {
                let left = Math.ceil(CD_FISH - (now - db[senderId].lastFish) / 1000);
                return msg.reply(`⏳ Wait *${left}s* for fish to gather back.`);
            }
            db[senderId].lastFish = now;
            const roll = Math.random() * 100;
            if (roll <= 12) {
                let loss = Math.min(Math.floor(Math.random() * 1500) + 1000, db[senderId].wallet);
                db[senderId].wallet -= loss; saveDB();
                return msg.reply(`🦈 *SHARK ATTACK!* You lost *-$${loss.toLocaleString()}*! 🌊`);
            } else if (roll <= 25) {
                db[senderId].inventory.goldenFish = (db[senderId].inventory.goldenFish || 0) + 1; saveDB();
                return msg.reply(`🎣 *LEGENDARY!* You caught a *✨ Golden Fish*! Check \`.inv\``);
            } else if (roll <= 55) {
                db[senderId].inventory.salmon = (db[senderId].inventory.salmon || 0) + 1; saveDB();
                return msg.reply(`🎣 *Nice catch!* You reeled in a premium *🐟 Salmon*!`);
            } else if (roll <= 80) {
                // BUG FIX: store the minnow fish in inventory instead of giving coins
                db[senderId].inventory.fish = (db[senderId].inventory.fish || 0) + 1; saveDB();
                return msg.reply(`🎣 You caught a small *🐟 Minnow Fish*! Sell it with \`.sell fish\`.`);
            } else {
                saveDB();
                return msg.reply(`🎣 Sat on the dock for 45 minutes. Nothing bit. Go home.`);
            }
        }

        // ── .casino ───────────────────────────────────────────────────────────
        if (command === '.casino') {
            initUser(senderId); const now = Date.now();
            if ((now - db[senderId].lastCasino) / 1000 < CD_CASINO) {
                let left = Math.ceil(CD_CASINO - (now - db[senderId].lastCasino) / 1000);
                return msg.reply(`🎰 Casino threw you out. Wait *${Math.floor(left/60)}m ${left%60}s*.`);
            }
            let bet = parseInt(args[1]);
            if (isNaN(bet) || bet <= 0 || bet > db[senderId].wallet) return msg.reply('❌ Enter a real bet you own.');
            db[senderId].lastCasino = now;
            const syms = ['🎲','🎰','💎','🃏','💰'];
            let r1 = syms[Math.floor(Math.random()*syms.length)];
            let r2 = syms[Math.floor(Math.random()*syms.length)];
            let r3 = syms[Math.floor(Math.random()*syms.length)];
            let layout = `🎰 *LAS VEGAS PREMIUM CASINO* 🎰\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n  [ ${r1} | ${r2} | ${r3} ]  \n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n`;
            if (Math.random() * 100 <= 46) {
                db[senderId].wallet += bet; saveDB();
                layout += `🟢 *WINNER!* You got: *+$${bet.toLocaleString()}*\n👛 Wallet: $${db[senderId].wallet.toLocaleString()}`;
            } else {
                db[senderId].wallet -= bet; saveDB();
                layout += `😢 *HOUSE WINS!* Lost: *-$${bet.toLocaleString()}*\n👛 Wallet: $${db[senderId].wallet.toLocaleString()}`;
            }
            return msg.reply(layout);
        }

        // ── .slots ────────────────────────────────────────────────────────────
        if (command === '.slots') {
            initUser(senderId); const now = Date.now();
            if ((now - db[senderId].lastSlots) / 1000 < CD_SLOTS) {
                let left = Math.ceil(CD_SLOTS - (now - db[senderId].lastSlots) / 1000);
                return msg.reply(`⏳ Lever stuck! Wait *${left}s*.`);
            }
            let bet = parseInt(args[1]);
            if (isNaN(bet) || bet <= 0 || bet > db[senderId].wallet) return msg.reply('❌ Usage: `.slots [bet]`');
            db[senderId].lastSlots = now;
            const items = ['🍎','💎','🍓','🍒','🔔'];
            let r1 = items[Math.floor(Math.random()*items.length)];
            let r2 = items[Math.floor(Math.random()*items.length)];
            let r3 = items[Math.floor(Math.random()*items.length)];
            let layout = `🎰 *SLOT MACHINE CORE* 🎰\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n  [ ${r1} | ${r2} | ${r3} ]  \n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n`;
            if (r1===r2 && r2===r3) {
                let payout = bet*4; db[senderId].wallet += payout; saveDB();
                layout += `🎉 *JACKPOT!* 3x Match! Earned *+$${payout.toLocaleString()}*!`;
            } else if (r1===r2 || r2===r3 || r1===r3) {
                let payout = Math.floor(bet*1.5); db[senderId].wallet += payout; saveDB();
                layout += `✨ *MINI WIN!* 2x Match! Gained *+$${payout.toLocaleString()}*!`;
            } else {
                db[senderId].wallet -= bet; saveDB();
                layout += `❌ *LOST!* Deducted *-$${bet.toLocaleString()}*`;
            }
            return msg.reply(layout);
        }

        // ── .roulette ─────────────────────────────────────────────────────────
        if (command === '.roulette') {
            initUser(senderId); const now = Date.now();
            if ((now - db[senderId].lastRoulette) / 1000 < CD_ROULETTE) {
                let left = Math.ceil(CD_ROULETTE - (now - db[senderId].lastRoulette) / 1000);
                return msg.reply(`⏳ Wheel spinning. Wait *${left}s*.`);
            }
            let space = args[1] ? args[1].toLowerCase() : '';
            let bet = parseInt(args[2]);
            if (!['red','black','green'].includes(space) || isNaN(bet) || bet <= 0 || bet > db[senderId].wallet)
                return msg.reply('❌ Format: `.roulette [red/black/green] [bet]`');
            db[senderId].lastRoulette = now;
            let rollNum = Math.floor(Math.random() * 37);
            let landedColor = rollNum === 0 ? 'green' : ([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].includes(rollNum) ? 'red' : 'black');
            let rouletteText = `🎡 *ROULETTE BOARD* 🎡\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\nResult: *${landedColor.toUpperCase()} (${rollNum})*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n`;
            if (space === landedColor) {
                let prize = space === 'green' ? bet * 14 : bet;
                db[senderId].wallet += prize; saveDB();
                rouletteText += `🟢 *WINNER!* You won: *+$${prize.toLocaleString()}*`;
            } else {
                db[senderId].wallet -= bet; saveDB();
                rouletteText += `🔴 *HOUSE WINS!* Lost: *-$${bet.toLocaleString()}*`;
            }
            return msg.reply(rouletteText);
        }

        // ── .db / .double ─────────────────────────────────────────────────────
        if (command === '.db' || command === '.double') {
            initUser(senderId); checkDailyReset(senderId);
            if (db[senderId].dailyDbCount >= 15) return msg.reply('⚖️ Daily cap reached! Max 15/day.');
            const now = Date.now();
            if ((now - db[senderId].lastDb) / 1000 < CD_DB) {
                let left = Math.ceil(CD_DB - (now - db[senderId].lastDb) / 1000);
                return msg.reply(`⏳ Wait *${left}s*.`);
            }
            let bet = parseInt(args[1]);
            if (isNaN(bet) || bet <= 0 || bet > db[senderId].wallet) return msg.reply('❌ Invalid bet.');
            db[senderId].lastDb = now; db[senderId].dailyDbCount += 1;
            if (Math.random() * 100 < 48) {
                db[senderId].wallet += bet; saveDB();
                return msg.reply(`🟢 *DOUBLE SUCCESS!* +$${bet.toLocaleString()} [${db[senderId].dailyDbCount}/15]`);
            } else {
                db[senderId].wallet -= bet; saveDB();
                return msg.reply(`🔴 *CRASHED!* -$${bet.toLocaleString()} [${db[senderId].dailyDbCount}/15]`);
            }
        }

        // ── .cf / .coinflip ───────────────────────────────────────────────────
        if (command === '.cf' || command === '.coinflip') {
            initUser(senderId); const now = Date.now();
            if ((now - db[senderId].lastCoinflip) / 1000 < CD_COINFLIP) {
                let left = Math.ceil(CD_COINFLIP - (now - db[senderId].lastCoinflip) / 1000);
                return msg.reply(`⏳ Wait *${left}s*.`);
            }
            let userChoice = args[1] ? args[1].toLowerCase() : '';
            let bet = parseInt(args[2]);
            if (!['h','t','heads','tails'].includes(userChoice) || isNaN(bet) || bet <= 0 || bet > db[senderId].wallet)
                return msg.reply('❌ Syntax: `.cf [heads/tails] [bet]`');
            db[senderId].lastCoinflip = now;
            let choiceMap = { h:'heads', t:'tails', heads:'heads', tails:'tails' };
            let pick = choiceMap[userChoice];
            let spin = Math.random() > 0.5 ? 'heads' : 'tails';
            let coinEmoji = spin === 'heads' ? '🪙 (Heads)' : '📀 (Tails)';
            let layout = `🪙 *COINFLIP* 🪙\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\nLanded: *${coinEmoji}*\nYour Call: *${pick.toUpperCase()}*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n`;
            if (pick === spin) {
                db[senderId].wallet += bet; saveDB();
                layout += `🟢 *VICTORY!* +$${bet.toLocaleString()}\n👛 Wallet: $${db[senderId].wallet.toLocaleString()}`;
            } else {
                db[senderId].wallet -= bet; saveDB();
                layout += `🔴 *DEFEAT!* -$${bet.toLocaleString()}\n👛 Wallet: $${db[senderId].wallet.toLocaleString()}`;
            }
            return msg.reply(layout);
        }

        // ── .deposit / .withdraw ──────────────────────────────────────────────
        if (command === '.deposit' || command === '.dep') {
            initUser(senderId);
            if (db[senderId].wallet <= 0) return msg.reply('❌ Nothing to deposit.');
            let s = args[1]; let amt = (!s || s.toLowerCase() === 'all') ? db[senderId].wallet : parseInt(s);
            if (isNaN(amt) || amt <= 0 || amt > db[senderId].wallet) return msg.reply('❌ Invalid amount.');
            db[senderId].wallet -= amt; db[senderId].bank += amt; saveDB();
            return msg.reply(`🏦 *Deposited:* $${amt.toLocaleString()}\n🏦 Bank: $${db[senderId].bank.toLocaleString()}`);
        }

        if (command === '.withdraw' || command === '.wd') {
            initUser(senderId); let s = args[1];
            if (!s) return msg.reply('❌ Enter amount to withdraw.');
            let amt = s.toLowerCase() === 'all' ? db[senderId].bank : parseInt(s);
            if (isNaN(amt) || amt <= 0 || amt > db[senderId].bank) return msg.reply("❌ You don't have that in bank.");
            db[senderId].bank -= amt; db[senderId].wallet += amt; saveDB();
            return msg.reply(`📊 *Withdrew:* $${amt.toLocaleString()}\n👛 Wallet: $${db[senderId].wallet.toLocaleString()}`);
        }

        // ── .health ───────────────────────────────────────────────────────────
        if (command === '.health') {
            initUser(senderId);
            let party = db[senderId].pokemon || [];
            if (party.length === 0) return msg.reply('❌ No Pokémon! Catch one with *.catch* in a group.');
            let p = party[0];
            if (!p.maxHp) { let lk = WILD_POKEMON_POOL.find(w => w.name.toLowerCase() === p.name.toLowerCase()) || { hp: 50, atk: 50 }; p.maxHp = lk.hp; p.hp = lk.hp; saveDB(); }
            let toxic = isToxic(senderId, p.name);
            let healthCard = `🩺 *PARTNER DIAGNOSTICS* 🩺\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
                             `🔰 *Active:* *${p.emoji} ${p.name}*\n` +
                             `🌟 *Level:* Rank ${p.level || 1}\n` +
                             `⚔️ *Attack:* ${p.atk} ATK\n` +
                             `❤️ *HP:* ${p.hp} / ${p.maxHp}\n` +
                             `📊 [ ${makeProgressBar(p.hp, p.maxHp)} ]\n` +
                             `${toxic ? '☠️ *STATUS: TOXIC!* (temp debuff active)\n' : ''}` +
                             `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;
            try {
                let media = await MessageMedia.fromUrl(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${p.dexId || 1}.png`);
                return chatObj.sendMessage(media, { caption: healthCard });
            } catch (_) { return msg.reply(healthCard); }
        }

        // ── .use ──────────────────────────────────────────────────────────────
        if (command === '.use') {
            initUser(senderId);
            let party = db[senderId].pokemon || [];
            if (party.length === 0) return msg.reply('❌ No Pokémon in roster! Catch one first.');
            let name = args.slice(1).join(' ').trim().toLowerCase();
            if (!name) return msg.reply('❌ Syntax: `.use [pokemon_name]`');
            let idx = party.findIndex(p => p.name.toLowerCase() === name);
            if (idx === -1) return msg.reply(`❌ You don't own *${name}*. Check \`.inv\`.`);
            if (idx === 0) return msg.reply(`⚡ *${party[0].name}* is already your active partner!`);
            let chosen = party.splice(idx, 1)[0];
            party.unshift(chosen); saveDB();
            return chatObj.sendMessage(
                `🔄 *SQUAD UPDATED!*\n🟢 *Deployed:* ${chosen.emoji} *${chosen.name}* [Lv.${chosen.level||1}]\n❤️ HP: ${makeProgressBar(chosen.hp, chosen.maxHp||50)} (${chosen.hp}/${chosen.maxHp||50})`,
                { mentions: [senderId] }
            ).catch(() => {});
        }

        // ── .transfer ─────────────────────────────────────────────────────────
        if (command === '.transfer') {
            initUser(senderId);
            let target = msg.hasQuotedMsg ? (await msg.getQuotedMessage()).author : msg.mentionedIds[0];
            if (!target) return msg.reply('❌ Tag someone or reply to their message.');
            if (target === senderId) return msg.reply('❌ Cannot transfer to yourself.');
            let amtStr = ''; let allFlag = false;
            for (let i = 1; i < args.length; i++) {
                if (args[i].toLowerCase() === 'all') { allFlag = true; break; }
                let clean = args[i].replace(/[^0-9]/g,'');
                if (clean && !args[i].includes('@')) { amtStr = clean; break; }
            }
            let amt = allFlag ? db[senderId].wallet : parseInt(amtStr);
            if (isNaN(amt) || amt <= 0) return msg.reply('❌ Usage: `.transfer [amount] [@tag]`');
            if (amt > db[senderId].wallet) return msg.reply(`❌ You only have *$${db[senderId].wallet.toLocaleString()}*.`);
            initUser(target);
            db[senderId].wallet -= amt; db[target].wallet += amt; saveDB();
            const txnId = 'TXN-' + Math.floor(100000 + Math.random() * 900000) + 'X';
            const receipt = `⚡ *RESERVE BANK WIRE TRANSFER* ⚡\n` +
                            `•———————————•———————————•\n` +
                            `   🏷️ *STATUS:* [ SUCCESS ✅ ]\n` +
                            `•———————————•———————————•\n\n` +
                            `📤 *Sender:* ${senderId.split('@')[0]}\n` +
                            `📥 *Receiver:* ${target.split('@')[0]}\n\n` +
                            `💵 *Amount:* 〔 $${amt.toLocaleString()} 〕\n` +
                            `🧾 *Reference ID:* \`${txnId}\`\n\n` +
                            `•———————————•———————————•\n` +
                            `👛 *Your Balance:* $${db[senderId].wallet.toLocaleString()}\n` +
                            `•———————————•———————————•`;
            // Send as plain message (no @tag mentions as requested)
            return chatObj.sendMessage(receipt).catch(() => {});
        }

        // ── .rob ──────────────────────────────────────────────────────────────
        if (command === '.rob') {
            initUser(senderId);
            if (!isGroupChat) return msg.reply('❌ Robberies only in group chats!');
            const now = Date.now();
            if ((now - db[senderId].lastRob) / 1000 < CD_ROB) {
                let left = Math.ceil(CD_ROB - (now - db[senderId].lastRob) / 1000);
                return msg.reply(`🚔 Lay low for *${Math.floor(left/60)}m ${left%60}s*.`);
            }
            let targetId = msg.mentionedIds[0] || (msg.hasQuotedMsg ? (await msg.getQuotedMessage()).author : null);
            if (!targetId) return msg.reply('❌ Tag someone: `.rob @username`');
            if (targetId === senderId) return msg.reply('🤡 Robbing yourself? No.');
            initUser(targetId);
            if (db[targetId].wallet < 1000) return msg.reply(`❌ Target is too broke to rob!`);
            if (db[senderId].wallet < 500) return msg.reply('❌ Need at least *$500* to fund a heist.');
            db[senderId].lastRob = now;
            const roll = Math.random() * 100;
            if (roll <= 40) {
                const pct = Math.random() * 0.25 + 0.05;
                let stolen = Math.max(500, Math.min(Math.floor(db[targetId].wallet * pct), db[targetId].wallet));
                db[targetId].wallet -= stolen; db[senderId].wallet += stolen; saveDB();
                return chatObj.sendMessage(
                    `🦹 *HEIST SUCCESS!* 🦹\n@${senderId.split('@')[0]} robbed @${targetId.split('@')[0]}!\n💰 Stolen: *+$${stolen.toLocaleString()}*\n👛 Your Wallet: $${db[senderId].wallet.toLocaleString()}`,
                    { mentions: [senderId, targetId] }
                ).catch(() => {});
            } else if (roll <= 80) {
                let fine = Math.max(500, Math.min(Math.floor(db[senderId].wallet * 0.15), db[senderId].wallet));
                db[senderId].wallet -= fine; saveDB();
                return chatObj.sendMessage(
                    `🚔 *CAUGHT!* @${senderId.split('@')[0]} tried to rob @${targetId.split('@')[0]}!\n💸 Fine: *-$${fine.toLocaleString()}*`,
                    { mentions: [senderId, targetId] }
                ).catch(() => {});
            } else {
                saveDB();
                return chatObj.sendMessage(
                    `🏃 @${senderId.split('@')[0]} attempted a robbery on @${targetId.split('@')[0]} but escaped with nothing!`,
                    { mentions: [senderId, targetId] }
                ).catch(() => {});
            }
        }

        // ── .sell ─────────────────────────────────────────────────────────────
        if (command === '.sell') {
            initUser(senderId);
            const item = args[1] ? args[1].toLowerCase() : '';
            const inv = db[senderId].inventory;
            if (!item) {
                return msg.reply(
                    `🐟 *MARITIME MARKET*\n• \`.sell fish\` — $200 each\n• \`.sell salmon\` — $800 each\n• \`.sell goldenfish\` — $5,000 each\n• \`.sell all\` — Sell everything\n\n` +
                    `📦 Stock: 🐟 x${inv.fish||0} | 🐟 x${inv.salmon||0} | ✨🐟 x${inv.goldenFish||0}`
                );
            }
            if (item === 'all') {
                let total = 0; let breakdown = '';
                for (let c of [{key:'fish',price:200,name:'Minnow',emoji:'🐟'},{key:'salmon',price:800,name:'Salmon',emoji:'🐟'},{key:'goldenFish',price:5000,name:'Golden Fish',emoji:'✨🐟'}]) {
                    const qty = inv[c.key] || 0;
                    if (qty > 0) { total += qty * c.price; breakdown += `${c.emoji} x${qty} ➔ +$${(qty*c.price).toLocaleString()}\n`; inv[c.key] = 0; }
                }
                if (total === 0) return msg.reply('❌ Fish inventory empty! Go `.fish` first.');
                db[senderId].wallet += total; saveDB();
                return msg.reply(`🐟 *BULK SALE*\n${breakdown}\n💰 Total: *+$${total.toLocaleString()}*\n👛 Wallet: $${db[senderId].wallet.toLocaleString()}`);
            }
            const entry = FISH_SELL_PRICES[item];
            if (!entry) return msg.reply('❌ Unknown item. Try `.sell fish`, `.sell salmon`, or `.sell goldenfish`.');
            const qty = inv[entry.key] || 0;
            if (qty === 0) return msg.reply(`❌ No ${entry.name} to sell. Go \`.fish\` first.`);
            const earned = qty * entry.price; inv[entry.key] = 0; db[senderId].wallet += earned; saveDB();
            return msg.reply(`🐟 Sold *${qty}x ${entry.name}* for *+$${earned.toLocaleString()}*!\n👛 Wallet: $${db[senderId].wallet.toLocaleString()}`);
        }

        // ── .daily ────────────────────────────────────────────────────────────
        if (command === '.daily') {
            initUser(senderId); const now = Date.now();
            const oneDay = 86400000; const twoDays = 172800000;
            if (db[senderId].lastDaily && (now - db[senderId].lastDaily) < oneDay) {
                let rem = oneDay - (now - db[senderId].lastDaily);
                let h = Math.floor(rem / 3600000); let m = Math.floor((rem % 3600000) / 60000);
                return msg.reply(`⏳ Daily claimed! Come back in *${h}h ${m}m*.\n🔥 Streak: *${db[senderId].dailyStreak} days*`);
            }
            if (db[senderId].lastDaily && (now - db[senderId].lastDaily) < twoDays) {
                db[senderId].dailyStreak = (db[senderId].dailyStreak || 0) + 1;
            } else { db[senderId].dailyStreak = 1; }
            const streak = db[senderId].dailyStreak;
            const base = Math.floor(Math.random() * 45000) + 5000;
            const bonus = (streak - 1) * 2500;
            const total = base + bonus;
            const balls = streak >= 7 ? 5 : streak >= 3 ? 3 : 2;
            db[senderId].lastDaily = now; db[senderId].wallet += total;
            db[senderId].inventory.pokeball = (db[senderId].inventory.pokeball || 0) + balls; saveDB();
            const streakEmoji = streak >= 30 ? '🏆' : streak >= 14 ? '🔥' : streak >= 7 ? '⭐' : '✅';
            return msg.reply(
                `🎁 *DAILY REWARD UNLOCKED!* 🎁\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
                `${streakEmoji} *Streak:* ${streak} day${streak>1?'s':''}\n` +
                `💵 Base: *+$${base.toLocaleString()}*\n⭐ Streak Bonus: *+$${bonus.toLocaleString()}*\n🔴 Free Pokéballs: *+${balls}*\n` +
                `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n💰 *Total: +$${total.toLocaleString()}*\n👛 Wallet: $${db[senderId].wallet.toLocaleString()}`
            );
        }

        // ── .shop ─────────────────────────────────────────────────────────────
        if (command === '.shop') {
            initUser(senderId);
            const p1 = args[1] ? args[1].toLowerCase() : '';
            const p2 = args[2] ? args[2].toLowerCase() : '';

            if (p1 === 'balls' || p1 === 'pokeballs') {
                let menu = `🔴 *POKÉBALL SHOP* 🔴\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n`;
                for (let key in POKEBALL_SHOP) {
                    const b = POKEBALL_SHOP[key];
                    menu += `${b.emoji} *${b.name}* — $${b.price.toLocaleString()} (\`.buy ${key}\`)\n📝 ${b.desc}\n\n`;
                }
                return msg.reply(menu);
            }
            if (p1 === 'food' || (p1 === 'pokemon' && p2 === 'food')) {
                let menu = `🍗 *POKÉMON FOOD SHOP* 🍗\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n`;
                for (let key in FOOD_SHOP) {
                    const f = FOOD_SHOP[key];
                    menu += `${f.emoji} *${f.name}* — $${f.price.toLocaleString()} (\`.buy ${key}\`)\n📝 ${f.desc}\n\n`;
                }
                return msg.reply(menu);
            }
            // Main shop menu (no pokemon buying store)
            return msg.reply(
                `🛒 *SHOP MENU* 🛒\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
                `🔴 \`.shop balls\` — Pokéball store\n` +
                `🍗 \`.shop food\` — Pokémon food & items\n\n` +
                `💡 To buy anything: \`.buy [item_name]\`\n` +
                `_Pokémon can only be obtained by catching wild ones!_ 🌿`
            );
        }

        // ── .buy ──────────────────────────────────────────────────────────────
        if (command === '.buy') {
            initUser(senderId);
            let itemKey = args[1] ? args[1].toLowerCase() : '';
            if (!itemKey) return msg.reply('❌ Usage: `.buy [item_name]`');

            if (FOOD_SHOP[itemKey]) {
                let prod = FOOD_SHOP[itemKey];
                if (db[senderId].wallet < prod.price) return msg.reply(`❌ Not enough cash! Price: $${prod.price.toLocaleString()}`);
                db[senderId].wallet -= prod.price;
                db[senderId].inventory[itemKey] = (db[senderId].inventory[itemKey] || 0) + 1; saveDB();
                return msg.reply(`🛍️ Purchased 1x ${prod.emoji} *${prod.name}*! Check \`.inv\`.`);
            }
            if (POKEBALL_SHOP[itemKey]) {
                let ball = POKEBALL_SHOP[itemKey];
                if (db[senderId].wallet < ball.price) return msg.reply(`❌ Not enough cash! Price: $${ball.price.toLocaleString()}`);
                db[senderId].wallet -= ball.price;
                db[senderId].inventory[itemKey] = (db[senderId].inventory[itemKey] || 0) + 1; saveDB();
                return msg.reply(`🛍️ Purchased 1x ${ball.emoji} *${ball.name}*! Check \`.inv\`.`);
            }
            return msg.reply('❌ Item not found! Check \`.shop\` for available items.');
        }

        // ── .feed ─────────────────────────────────────────────────────────────
        // Usage: .feed | .feed pikachu | .feed pikachu coke
        if (command === '.feed') {
            initUser(senderId);
            let party = db[senderId].pokemon || [];
            if (party.length === 0) return msg.reply('❌ No Pokémon! Catch one in a group first.');

            let targetPoke = null;
            let foodKey = null;

            if (args.length === 1) {
                // .feed — auto-feed active Pokémon with first available food
                targetPoke = party[0];
                const inv = db[senderId].inventory;
                for (let key of Object.keys(FOOD_SHOP)) {
                    if (inv[key] && inv[key] > 0) { foodKey = key; break; }
                }
                if (!foodKey) return msg.reply('❌ No food in inventory! Buy some with \`.buy [food]\`.Use \`.shop food\` to see options.');
            } else if (args.length === 2) {
                // .feed pikachu — feed active (or named) Pokémon with first available food
                const possiblePoke = args[1].toLowerCase();
                const foundPoke = party.find(p => p.name.toLowerCase() === possiblePoke);
                if (foundPoke) {
                    targetPoke = foundPoke;
                    const inv = db[senderId].inventory;
                    for (let key of Object.keys(FOOD_SHOP)) {
                        if (inv[key] && inv[key] > 0) { foodKey = key; break; }
                    }
                    if (!foodKey) return msg.reply('❌ No food in inventory! Buy some with \`.buy [food]\`.Use \`.shop food\` to see what\'s available.');
                } else {
                    // Maybe it's .feed coke (feed active Pokémon with specific food)
                    foodKey = possiblePoke;
                    targetPoke = party[0];
                    if (!FOOD_SHOP[foodKey]) return msg.reply(`❌ No Pokémon named "${args[1]}" or food named "${args[1]}" found.`);
                }
            } else {
                // .feed pikachu coke
                const pokeName = args.slice(1, args.length - 1).join(' ').toLowerCase();
                foodKey = args[args.length - 1].toLowerCase();
                targetPoke = party.find(p => p.name.toLowerCase() === pokeName);
                if (!targetPoke) return msg.reply(`❌ No Pokémon named "${pokeName}" in your roster. Check \`.inv\`.`);
                if (!FOOD_SHOP[foodKey]) return msg.reply(`❌ Unknown food "${foodKey}". Check \`.shop food\`.`);
            }

            const food = FOOD_SHOP[foodKey];
            const inv = db[senderId].inventory;
            if (!inv[foodKey] || inv[foodKey] <= 0) return msg.reply(`❌ Out of *${food.name}*! Buy with \`.buy ${foodKey}\`.`);

            // Fix maxHp if missing
            if (!targetPoke.maxHp || targetPoke.maxHp === 'undefined') {
                let lk = WILD_POKEMON_POOL.find(w => w.name.toLowerCase() === targetPoke.name.toLowerCase()) || { hp: 50, atk: 50 };
                targetPoke.maxHp = lk.hp; targetPoke.hp = lk.hp;
            }
            if (!targetPoke.atk) {
                let lk = WILD_POKEMON_POOL.find(w => w.name.toLowerCase() === targetPoke.name.toLowerCase()) || { atk: 50 };
                targetPoke.atk = lk.atk;
            }

            // Refuse if HP already full (for regular food)
            if (foodKey !== 'mrbeast' && targetPoke.hp >= targetPoke.maxHp && !food.isAlcohol) {
                return msg.reply(`🍽️ *${targetPoke.emoji} ${targetPoke.name}* is already at full health and refuses to eat!\n❤️ HP: ${targetPoke.hp}/${targetPoke.maxHp} — already full!`);
            }

            const pokeName = targetPoke.name.toLowerCase();

            // ── Alcohol/Toxic handling ────────────────────────────────────────
            if (food.isAlcohol) {
                if (!db[senderId].toxicity[pokeName]) db[senderId].toxicity[pokeName] = { alcoholCount: 0, cigarCount: 0, toxicUntil: 0 };
                const tox = db[senderId].toxicity[pokeName];

                // Check if already toxic
                if (isToxic(senderId, pokeName)) {
                    const rem = Math.ceil((tox.toxicUntil - Date.now()) / 60000);
                    return msg.reply(`☠️ *${targetPoke.emoji} ${targetPoke.name}* is already *INTOXICATED* and refuses anything else!\n⏳ Toxic wears off in *${rem} min*.`);
                }

                const isCigar = foodKey === 'cigar' || foodKey === 'cigarette';
                if (isCigar) tox.cigarCount = (tox.cigarCount || 0) + 1;
                else tox.alcoholCount = (tox.alcoholCount || 0) + 1;
                const count = isCigar ? tox.cigarCount : tox.alcoholCount;
                const label = isCigar ? 'smokes' : 'drinks';

                inv[foodKey] -= 1;
                let result = '';

                if (count <= 3) {
                    // Beneficial: heal + ATK buff
                    const oldHp = targetPoke.hp;
                    targetPoke.hp = Math.min(targetPoke.maxHp, targetPoke.hp + food.heal);
                    db[senderId].atkBuff = (db[senderId].atkBuff || 0) + (food.atkBuff || 0);
                    saveDB();
                    result = `${food.emoji} *${targetPoke.name}* had ${food.name}! (${label} #${count}/3)\n` +
                             `❤️ HP: ${oldHp} ➔ *${targetPoke.hp}/${targetPoke.maxHp}*\n` +
                             `⚔️ Temp ATK Buff: *+${food.atkBuff}* for next battle!\n` +
                             `⚠️ _(3 uses max — after that it gets toxic!)_`;
                } else {
                    // Toxic! Set toxicity timer
                    const toxDurations = { rum: 10, whiskey: 12, cigar: 10, cigarette: 15, beer: 10 };
                    const toxMins = toxDurations[foodKey] || 10;
                    tox.toxicUntil = Date.now() + toxMins * 60000;
                    // Penalize: remove ATK buff + reduce HP
                    const dmg = Math.floor(targetPoke.maxHp * 0.2);
                    targetPoke.hp = Math.max(1, targetPoke.hp - dmg);
                    db[senderId].atkBuff = 0;
                    saveDB();
                    result = `☠️ *OVERDOSE!* *${targetPoke.name}* consumed too much ${food.emoji}!\n` +
                             `🤢 It's now *TOXIC* for the next *${toxMins} minutes*!\n` +
                             `📉 HP dropped by ${dmg}! Now: *${targetPoke.hp}/${targetPoke.maxHp}*\n` +
                             `⚔️ All ATK buffs removed!\n` +
                             `💊 _Wait for detox or use \`.buy protein\` to help recovery._`;
                }
                return msg.reply(result);
            }

            // ── Normal food ───────────────────────────────────────────────────
            inv[foodKey] -= 1;
            const initHp = targetPoke.hp;
            const initMaxHp = targetPoke.maxHp;
            const initAtk = targetPoke.atk;

            if (foodKey === 'mrbeast') {
                targetPoke.maxHp += 50; targetPoke.atk += 25; targetPoke.hp = targetPoke.maxHp; saveDB();
                return msg.reply(
                    `✨ *MRBEAST UPGRADE!* ✨\n*${targetPoke.emoji} ${targetPoke.name}* consumed the $10M Chocolate!\n` +
                    `❤️ Max HP: ${initMaxHp} ➔ *${targetPoke.maxHp}* (+50 forever)\n` +
                    `🗡️ Attack: ${initAtk} ➔ *${targetPoke.atk}* (+25 forever)\n💚 Fully healed!`
                );
            }

            // sushi XP bonus
            if (foodKey === 'sushi' && food.xpBonus) {
                targetPoke.xp = (targetPoke.xp || 0) + food.xpBonus;
                if (targetPoke.xp >= (targetPoke.maxXp || 100)) { targetPoke.level = (targetPoke.level || 1) + 1; targetPoke.xp = 0; }
            }
            // energy ATK buff
            if (foodKey === 'energy' && food.atkBuff) {
                db[senderId].atkBuff = (db[senderId].atkBuff || 0) + food.atkBuff;
            }
            // mystery XP
            if (foodKey === 'mystery') {
                targetPoke.xp = (targetPoke.xp || 0) + 20;
                if (targetPoke.xp >= (targetPoke.maxXp || 100)) { targetPoke.level = (targetPoke.level || 1) + 1; targetPoke.xp = 0; }
            }

            targetPoke.hp = food.energy === 100 ? targetPoke.maxHp : Math.min(targetPoke.maxHp, initHp + food.heal);
            saveDB();
            return msg.reply(
                `🐾 Fed 1x ${food.emoji} *${food.name}* to *${targetPoke.emoji} ${targetPoke.name}*!\n` +
                `❤️ HP: ${initHp}/${targetPoke.maxHp} ➔ *${targetPoke.hp}/${targetPoke.maxHp}*` +
                (food.xpBonus ? `\n⭐ +${food.xpBonus} XP!` : '') +
                (food.atkBuff && foodKey === 'energy' ? `\n⚔️ +${food.atkBuff} temp ATK for next battle!` : '')
            );
        }

        // ── .inv ──────────────────────────────────────────────────────────────
        if (command === '.inv' || command === '.inventory') {
            let target = msg.hasQuotedMsg ? (await msg.getQuotedMessage()).author : (msg.mentionedIds[0] || senderId);
            initUser(target);
            const inv = db[target].inventory; const party = db[target].pokemon || [];
            let msgText = `🎒 *@${target.split('@')[0]}'s Inventory* 📦\n` +
                          `💼 Bag: ${inv.assignedBag || 'Basic Sack'}\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
                          `🔴 *POKÉBALLS:*\n` +
                          `• 🔴 Pokéball x${inv.pokeball||0} | 🔵 Great Ball x${inv.greatball||0}\n` +
                          `• ⚫ Ultra Ball x${inv.ultraball||0} | 🟣 Master Ball x${inv.masterball||0}\n` +
                          `• ⚙️ Heavy Ball x${inv.heavyball||0} | 🎣 Lure Ball x${inv.lureball||0}\n\n` +
                          `🔧 *TOOLS:* ⛏️ Shovel x${inv.shovel} | 🎣 Fishing Rod x${inv.fishingRod}\n\n` +
                          `🐠 *FISH:* ✨🐟 Golden x${inv.goldenFish||0} | 🐟 Salmon x${inv.salmon||0} | 🐟 Minnow x${inv.fish||0}\n\n` +
                          `🍗 *FOOD:*\n`;
            for (let key of Object.keys(FOOD_SHOP)) {
                const qty = inv[key] || 0;
                if (qty > 0) msgText += `• ${FOOD_SHOP[key].emoji} ${FOOD_SHOP[key].name}: x${qty}\n`;
            }
            msgText += `\n🐾 *POKÉMON ROSTER:*\n`;
            if (party.length === 0) {
                msgText += `_No Pokémon caught yet! Use \`.catch\` in a group._\n`;
            } else {
                party.forEach((p, i) => {
                    if (!p.maxHp) { let lk = WILD_POKEMON_POOL.find(w=>w.name.toLowerCase()===p.name.toLowerCase())||{hp:50}; p.maxHp=lk.hp; p.hp=lk.hp; }
                    const toxic = isToxic(target, p.name) ? ' ☠️TOXIC' : '';
                    msgText += `${i+1}. ${p.emoji} *${p.name}* Lv.${p.level||1} | ❤️ ${p.hp}/${p.maxHp} | ⚔️ ${p.atk}${toxic}\n`;
                });
                saveDB();
            }
            return chatObj.sendMessage(msgText, { mentions: [target] }).catch(() => {});
        }

        // ── .battle (PvP with moves) ───────────────────────────────────────────
        if (command === '.battle') {
            initUser(senderId);
            if (!isGroupChat) return msg.reply('❌ Battles only in group chats!');
            if (!msg.mentionedIds || msg.mentionedIds.length === 0) return msg.reply('❌ Tag an opponent: `.battle [@tag]`');
            let targetId = msg.mentionedIds[0];
            if (targetId === senderId) return msg.reply('🤡 Fighting yourself? Seek help.');
            initUser(targetId);

            let p1Party = db[senderId].pokemon || [];
            let p2Party = db[targetId].pokemon || [];
            if (p1Party.length === 0) return msg.reply('❌ You have no Pokémon! Catch one first.');
            if (p2Party.length === 0) return msg.reply('❌ Opponent has no Pokémon!');

            let p1 = p1Party[0]; let p2 = p2Party[0];
            if (!p1.maxHp) { let lk = WILD_POKEMON_POOL.find(w=>w.name.toLowerCase()===p1.name.toLowerCase())||{hp:50,atk:50}; p1.maxHp=lk.hp; p1.hp=lk.hp; p1.atk=lk.atk; }
            if (!p2.maxHp) { let lk = WILD_POKEMON_POOL.find(w=>w.name.toLowerCase()===p2.name.toLowerCase())||{hp:50,atk:50}; p2.maxHp=lk.hp; p2.hp=lk.hp; p2.atk=lk.atk; }

            if (p1.hp < 10) return msg.reply(`❌ *${p1.emoji} ${p1.name}* is too weak (${p1.hp} HP)! Feed it first with \`.feed\`.`);
            if (isToxic(senderId, p1.name)) return msg.reply(`❌ *${p1.emoji} ${p1.name}* is TOXIC and can't battle! Wait for detox.`);

            pendingBattles[targetId] = { challengerId: senderId, challengerName: senderId.split('@')[0], defenderName: targetId.split('@')[0] };
            const moves1 = getMovesForPokemon(p1.name);
            let requestTxt = `🏟️ *BATTLE CHALLENGE!* 🏟️\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
                             `⚔️ @${senderId.split('@')[0]} challenges @${targetId.split('@')[0]}!\n` +
                             `🔴 *${p1.emoji} ${p1.name}* vs 🔵 *${p2.emoji} ${p2.name}*\n\n` +
                             `🟢 Type \`.accept\` to battle | 🔴 Type \`.reject\` to back down.\n` +
                             `_(Challenge expires in 2 min)_`;
            return chatObj.sendMessage(requestTxt, { mentions: [senderId, targetId] }).catch(() => {});
        }

        if (command === '.accept') {
            if (!pendingBattles[senderId]) return msg.reply('❌ No battle invitation found for you.');
            const bData = pendingBattles[senderId];
            delete pendingBattles[senderId];

            initUser(bData.challengerId); initUser(senderId);
            let p1 = db[bData.challengerId].pokemon[0];
            let p2 = db[senderId].pokemon[0];
            if (!p1.maxHp) { let lk=WILD_POKEMON_POOL.find(w=>w.name.toLowerCase()===p1.name.toLowerCase())||{hp:50,atk:50}; p1.maxHp=lk.hp; p1.hp=lk.hp; p1.atk=lk.atk; }
            if (!p2.maxHp) { let lk=WILD_POKEMON_POOL.find(w=>w.name.toLowerCase()===p2.name.toLowerCase())||{hp:50,atk:50}; p2.maxHp=lk.hp; p2.hp=lk.hp; p2.atk=lk.atk; }

            if (p2.hp < 10) return msg.reply(`❌ *${p2.name}* is too weak! Feed it first.`);
            if (isToxic(senderId, p2.name)) return msg.reply(`❌ *${p2.name}* is TOXIC and can't battle!`);

            // Apply ATK buffs
            const p1AtkBuff = db[bData.challengerId].atkBuff || 0;
            const p2AtkBuff = db[senderId].atkBuff || 0;
            const p1Battle = { ...p1, atk: (p1.atk || 50) + p1AtkBuff };
            const p2Battle = { ...p2, atk: (p2.atk || 50) + p2AtkBuff };
            db[bData.challengerId].atkBuff = 0; db[senderId].atkBuff = 0;

            const battleId = generateBattleId();
            activeBattles[battleId] = { p1: p1Battle, p2: p2Battle, p1Id: bData.challengerId, p2Id: senderId, turn: 'p1', wildMode: false };

            const moves1 = getMovesForPokemon(p1Battle.name);
            let startMsg = `🏟️ *BATTLE BEGINS!* 🏟️\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
                           `🔴 @${bData.challengerName}: *${p1Battle.emoji} ${p1Battle.name}* ❤️ ${p1Battle.hp}/${p1Battle.maxHp}\n` +
                           `🔵 @${bData.defenderName}: *${p2Battle.emoji} ${p2Battle.name}* ❤️ ${p2Battle.hp}/${p2Battle.maxHp}\n\n` +
                           `⚔️ @${bData.challengerName}'s turn! Choose a move:\n`;
            moves1.forEach((m, i) => { startMsg += `${i+1}. ${m.emoji} *${m.name}* (${m.damage[0]}-${m.damage[1]} dmg)${m.special?' ✨':''}\n`; });
            startMsg += `\nReply with move number or name!`;

            // Auto-timeout battle after 5 minutes
            setTimeout(() => { if (activeBattles[battleId]) { delete activeBattles[battleId]; chatObj.sendMessage(`⏰ *Battle ${battleId} timed out!* No moves made for 5 minutes.`).catch(() => {}); } }, 300000);

            return chatObj.sendMessage(startMsg, { mentions: [bData.challengerId, senderId] }).catch(() => {});
        }

        if (command === '.reject') {
            if (!pendingBattles[senderId]) return msg.reply('❌ No pending invitations.');
            const bData = pendingBattles[senderId]; delete pendingBattles[senderId];
            return chatObj.sendMessage(`❌ @${bData.defenderName} backed down from the challenge!`, { mentions: [bData.challengerId, senderId] }).catch(() => {});
        }

        // ── .catch (start wild battle) ────────────────────────────────────────
        if (command === '.catch') {
            if (!isGroupChat) return msg.reply('❌ Wild Pokémon only appear in groups!');
            initUser(senderId);
            const cid = chatObj.id._serialized;
            const wildState = wildPokemonState[cid];
            if (!wildState) return msg.reply('❌ No wild Pokémon lurking right now! Wait for one to spawn.');

            const wild = wildState.pokemon;

            // If already weakened — tell them to .throwball
            if (wildState.weakened) {
                return msg.reply(`🎯 *${wild.emoji} ${wild.name}* is already weakened! Use *.throwball [balltype]* to catch it!\n_(e.g. \`.throwball pokeball\`)_`);
            }

            let party = db[senderId].pokemon || [];
            if (party.length === 0) return msg.reply('❌ You need at least one Pokémon to battle! You can\'t catch with no team.');

            let myPoke = party[0];
            if (!myPoke.maxHp) { let lk=WILD_POKEMON_POOL.find(w=>w.name.toLowerCase()===myPoke.name.toLowerCase())||{hp:50,atk:50}; myPoke.maxHp=lk.hp; myPoke.hp=lk.hp; myPoke.atk=lk.atk; }
            if (myPoke.hp < 5) return msg.reply(`❌ *${myPoke.emoji} ${myPoke.name}* is almost fainted! Feed it first with \`.feed\`.`);
            if (isToxic(senderId, myPoke.name)) return msg.reply(`❌ *${myPoke.emoji} ${myPoke.name}* is TOXIC! It can't battle.`);

            // Set up wild battle
            const wildBattlePoke = { ...wild, hp: wild.hp, maxHp: wild.hp };
            const battleId = generateBattleId();

            activeBattles[battleId] = {
                p1: { ...myPoke },
                p2: wildBattlePoke,
                p1Id: senderId,
                p2Id: 'wild',
                turn: 'p1',
                wildMode: true,
                wildPokemon: wild,
                chatId: cid
            };

            // Remove wild state temporarily (battle in progress)
            delete wildPokemonState[cid];

            const myMoves = getMovesForPokemon(myPoke.name);
            let battleMsg = `⚔️ *WILD BATTLE STARTED!* ⚔️\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
                            `🔴 *${myPoke.emoji} ${myPoke.name}* ❤️ ${myPoke.hp}/${myPoke.maxHp}\n` +
                            `🟢 *${wild.emoji} ${wild.name}* [${wild.rarity}] ❤️ ${wild.hp}/${wild.hp}\n\n` +
                            `⚔️ @${senderId.split('@')[0]}, choose your move:\n`;
            myMoves.forEach((m, i) => { battleMsg += `${i+1}. ${m.emoji} *${m.name}* (${m.damage[0]}-${m.damage[1]} dmg)${m.special?' ✨':''}\n`; });
            battleMsg += `\nReply with move number or name to attack!`;

            // Auto-counter attack when it's wild's turn — handled in the move handler above
            // Wild auto-attacks after player moves (we need to trigger it)
            // We'll handle wild auto-attack by checking p2Id === 'wild' in the move handler
            return chatObj.sendMessage(battleMsg, { mentions: [senderId] }).catch(() => {});
        }

        // ── .throwball ────────────────────────────────────────────────────────
        if (command === '.throwball') {
            if (!isGroupChat) return msg.reply('❌ Catching only in groups!');
            initUser(senderId);
            const cid = chatObj.id._serialized;
            const wildState = wildPokemonState[cid];
            if (!wildState || !wildState.weakened) return msg.reply('❌ No weakened Pokémon to catch! Battle it first with *.catch*.');

            const wild = wildState.pokemon;
            const ballKey = args[1] ? args[1].toLowerCase() : 'pokeball';
            const ballInfo = POKEBALL_SHOP[ballKey];
            if (!ballInfo) return msg.reply(`❌ Unknown ball type! Options: ${Object.keys(POKEBALL_SHOP).join(', ')}`);

            const inv = db[senderId].inventory;
            if (!inv[ballKey] || inv[ballKey] <= 0) return msg.reply(`❌ No ${ballInfo.emoji} *${ballInfo.name}*! Buy from \`.shop balls\`.`);

            inv[ballKey] -= 1;

            // Suspense message + GIF
            try {
                const media = await MessageMedia.fromUrl(POKEBALL_GIF_URL);
                await chatObj.sendMessage(media, { caption: `🎯 @${senderId.split('@')[0]} threw a ${ballInfo.emoji} *${ballInfo.name}* at *${wild.emoji} ${wild.name}*!\n\n⏳ _The ball wobbles... come on... come on..._ 🤞`, mentions: [senderId] });
            } catch (_) {
                await chatObj.sendMessage(`🎯 @${senderId.split('@')[0]} threw a ${ballInfo.emoji} *${ballInfo.name}* at *${wild.emoji} ${wild.name}*!\n⏳ _Suspense..._ 🤞`, { mentions: [senderId] }).catch(() => {});
            }

            // 10-second suspense
            await new Promise(r => setTimeout(r, 10000));

            // Rarity-based catch rates
            const rateMap = { Weak: 75, Common: 60, Rare: 40, Epic: 25, Legendary: 10 };
            let catchChance = (rateMap[wild.rarity] || 50) + (ballInfo.catchBonus || 0);
            if (ballInfo.catchBonus >= 100) catchChance = 100; // masterball
            catchChance = Math.min(catchChance, 100);

            const caught = Math.random() * 100 <= catchChance;

            if (caught) {
                delete wildPokemonState[cid];
                const alreadyOwns = (db[senderId].pokemon || []).some(p => p.name.toLowerCase() === wild.name.toLowerCase());
                let resultMsg;
                if (alreadyOwns) {
                    const bonus = Math.floor(Math.random() * 30000) + 10000;
                    db[senderId].wallet += bonus; saveDB();
                    resultMsg = `🎉 *CAUGHT!* But you already own *${wild.name}*!\n💰 Released for a bounty: *+$${bonus.toLocaleString()}*!`;
                } else {
                    db[senderId].pokemon = db[senderId].pokemon || [];
                    db[senderId].pokemon.push({
                        name: wild.name, tier: wild.rarity, level: 1, xp: 0, maxXp: 100,
                        hp: wild.hp, maxHp: wild.hp, atk: wild.atk, emoji: wild.emoji, dexId: wild.dexId,
                        gender: Math.random() > 0.5 ? '♂' : '♀'
                    });
                    saveDB();
                    resultMsg = `🎉 *GOTCHA!* *${wild.emoji} ${wild.name}* [${wild.rarity}] was caught!\n❤️ HP: ${wild.hp} | ⚔️ ATK: ${wild.atk}\n\n🎊 *Congratulations @${senderId.split('@')[0]}!*\nType \`.inv\` to see your updated roster!`;
                }
                return chatObj.sendMessage(resultMsg, { mentions: [senderId] }).catch(() => {});
            } else {
                // 20% chance it already fled even after being weakened
                if (Math.random() < 0.2) {
                    delete wildPokemonState[cid];
                    return chatObj.sendMessage(`💨 *${wild.emoji} ${wild.name}* shook off the ball and *FLED!* Even after being weakened... unlucky! 😤\n🔴 ${ballInfo.name} used: ${inv[ballKey]+1} ➔ ${inv[ballKey]}`, { mentions: [senderId] }).catch(() => {});
                }
                // Still catchable
                saveDB();
                return chatObj.sendMessage(
                    `❌ *${wild.emoji} ${wild.name}* broke free from the ${ballInfo.emoji} ${ballInfo.name}!\n` +
                    `🔴 ${ballKey} remaining: ${inv[ballKey]}\n` +
                    `💡 Try again with \`.throwball [balltype]\` or use a stronger ball!`,
                    { mentions: [senderId] }
                ).catch(() => {});
            }
        }

    } catch (err) {
        console.error('Critical bot error:', err.message);
    }
});

// ── WILD BATTLE: Auto wild Pokémon counter-attack ─────────────────────────────
// We patch the move handler above — when p2Id === 'wild' and it's p2's turn,
// we auto-attack. This is handled inside the activeBattles loop in message_create.
// We need to extend that loop to handle wildMode auto-attack when turn switches to 'p2':
const _origCreate = client.listeners('message_create')[0];
// Override: after move handled, auto-respond for wild Pokémon
// This is already embedded in the move handler above by checking turn switches

// ── EXTEND: Handle wild auto-attack inline ────────────────────────────────────
// We add a second listener specifically for wild auto-attack resolution.
// Since it's in the same file, we inject into the activeBattles flow.
// The flow: player picks move → damage dealt → if wildMode and opp not fainted → auto-attack back
// This is handled by overriding the turn switch in the battle handler.
// Re-attach with wild auto-attack integrated:
client.removeAllListeners('message_create');

client.on('message_create', async msg => {
    try {
        const body = msg.body ? msg.body.trim() : '';
        const senderId = msg.author || msg.from;
        if (!body) return;

        const chatObj = await msg.getChat();
        const isGroupChat = chatObj.isGroup;

        let isMod = false;
        if (msg.fromMe) { isMod = true; }
        else {
            try {
                if (isGroupChat && chatObj.participants) {
                    isMod = chatObj.participants.some(p => p.id._serialized === senderId && (p.isAdmin || p.isSuperAdmin));
                } else if (!isGroupChat) { isMod = true; }
            } catch (_) {}
        }

        const lowerBody = body.toLowerCase().trim();

        // ── Active battle move handler ────────────────────────────────────────
        for (const [battleId, battle] of Object.entries(activeBattles)) {
            const isP1Turn = battle.turn === 'p1' && senderId === battle.p1Id;
            if (!isP1Turn) continue; // wild only has p1 (player) acting

            const myPoke  = battle.p1;
            const oppPoke = battle.p2;
            const moves   = getMovesForPokemon(myPoke.name);
            let chosenMove = null;
            const numMatch = parseInt(lowerBody);
            if (!isNaN(numMatch) && numMatch >= 1 && numMatch <= moves.length) chosenMove = moves[numMatch - 1];
            else chosenMove = moves.find(m => m.name.toLowerCase() === lowerBody);
            if (!chosenMove) continue;

            // Player attacks wild
            const dmg = Math.floor(Math.random() * (chosenMove.damage[1] - chosenMove.damage[0] + 1)) + chosenMove.damage[0];
            oppPoke.hp = Math.max(0, oppPoke.hp - dmg);

            let moveLog = `⚔️ *${myPoke.emoji} ${myPoke.name}* used *${chosenMove.emoji} ${chosenMove.name}*!\n` +
                          `💥 Dealt *${dmg}* dmg to ${oppPoke.emoji} ${oppPoke.name}!\n` +
                          `❤️ ${oppPoke.name} HP: ${makeProgressBar(oppPoke.hp, oppPoke.maxHp)} (${oppPoke.hp}/${oppPoke.maxHp})\n`;

            if (oppPoke.hp <= 0) {
                delete activeBattles[battleId];
                if (battle.wildMode) {
                    const wild = battle.wildPokemon;
                    moveLog += `\n🏆 *${myPoke.name} wins!* Wild ${wild.emoji} ${wild.name} is down!\n\n`;
                    moveLog += `🎯 Use *.throwball [balltype]* to catch it!\n_(e.g. \`.throwball ultraball\`)_\n⚠️ Flees in 30 seconds!`;
                    wildPokemonState[chatObj.id._serialized] = { pokemon: { ...wild, hp: 1 }, spawnTime: Date.now(), weakened: true, battleWinner: senderId };
                    setTimeout(() => {
                        const cid = chatObj.id._serialized;
                        if (wildPokemonState[cid]?.weakened) {
                            delete wildPokemonState[cid];
                            chatObj.sendMessage(`💨 The weakened ${wild.emoji} ${wild.name} recovered and fled!`).catch(() => {});
                        }
                    }, 30000);
                } else {
                    // PvP — shouldn't reach here since PvP has both p1 and p2 turns
                    initUser(senderId);
                    db[senderId].wallet += 50000; saveDB();
                    moveLog += `\n🏆 *${myPoke.name}* won! *+$50,000* prize!`;
                }
                return chatObj.sendMessage(moveLog, { mentions: [senderId] }).catch(() => {});
            }

            if (battle.wildMode) {
                // Wild auto counter-attacks
                const wildMoves = getMovesForPokemon(oppPoke.name);
                const wildMove = wildMoves[Math.floor(Math.random() * wildMoves.length)];
                const wildDmg = Math.floor(Math.random() * (wildMove.damage[1] - wildMove.damage[0] + 1)) + wildMove.damage[0];
                myPoke.hp = Math.max(0, myPoke.hp - wildDmg);

                moveLog += `\n🔄 *${oppPoke.emoji} ${oppPoke.name}* counter-attacked with *${wildMove.emoji} ${wildMove.name}*!\n` +
                           `💢 Dealt *${wildDmg}* dmg to ${myPoke.emoji} ${myPoke.name}!\n` +
                           `❤️ Your HP: ${makeProgressBar(myPoke.hp, myPoke.maxHp)} (${myPoke.hp}/${myPoke.maxHp})\n`;

                if (myPoke.hp <= 0) {
                    delete activeBattles[battleId];
                    // Wild Pokémon flees after defeating trainer
                    delete wildPokemonState[chatObj.id._serialized];
                    moveLog += `\n😵 *${myPoke.name} fainted!* The wild ${oppPoke.emoji} ${oppPoke.name} fled laughing!\n💊 Heal your Pokémon with \`.feed\` first.`;
                    // Sync HP to DB
                    const party = db[senderId]?.pokemon || [];
                    const found = party.find(p => p.name.toLowerCase() === myPoke.name.toLowerCase());
                    if (found) { found.hp = 0; saveDB(); }
                    return chatObj.sendMessage(moveLog, { mentions: [senderId] }).catch(() => {});
                }

                moveLog += `\n⚔️ Choose your next move:\n`;
                moves.forEach((m, i) => { moveLog += `${i+1}. ${m.emoji} *${m.name}* (${m.damage[0]}-${m.damage[1]} dmg)${m.special?' ✨':''}\n`; });
                // Sync HP to DB
                const party = db[senderId]?.pokemon || [];
                const found = party.find(p => p.name.toLowerCase() === myPoke.name.toLowerCase());
                if (found) { found.hp = myPoke.hp; saveDB(); }

            } else {
                // PvP: switch turn to p2
                battle.turn = 'p2';
                const p2Moves = getMovesForPokemon(oppPoke.name);
                moveLog += `\n⏳ @${battle.p2Id.split('@')[0]}'s turn! *${oppPoke.emoji} ${oppPoke.name}*:\n`;
                p2Moves.forEach((m, i) => { moveLog += `${i+1}. ${m.emoji} *${m.name}* (${m.damage[0]}-${m.damage[1]} dmg)${m.special?' ✨':''}\n`; });
                moveLog += `\nReply with move number or name!`;
            }

            return chatObj.sendMessage(moveLog, { mentions: [senderId] }).catch(() => {});
        }

        // PvP p2 turn handler
        for (const [battleId, battle] of Object.entries(activeBattles)) {
            if (battle.wildMode) continue;
            const isP2Turn = battle.turn === 'p2' && senderId === battle.p2Id;
            if (!isP2Turn) continue;

            const myPoke  = battle.p2;
            const oppPoke = battle.p1;
            const moves   = getMovesForPokemon(myPoke.name);
            let chosenMove = null;
            const numMatch = parseInt(lowerBody);
            if (!isNaN(numMatch) && numMatch >= 1 && numMatch <= moves.length) chosenMove = moves[numMatch - 1];
            else chosenMove = moves.find(m => m.name.toLowerCase() === lowerBody);
            if (!chosenMove) continue;

            const dmg = Math.floor(Math.random() * (chosenMove.damage[1] - chosenMove.damage[0] + 1)) + chosenMove.damage[0];
            oppPoke.hp = Math.max(0, oppPoke.hp - dmg);

            let moveLog = `⚔️ *${myPoke.emoji} ${myPoke.name}* used *${chosenMove.emoji} ${chosenMove.name}*!\n` +
                          `💥 Dealt *${dmg}* dmg to ${oppPoke.emoji} ${oppPoke.name}!\n` +
                          `❤️ ${oppPoke.name} HP: ${makeProgressBar(oppPoke.hp, oppPoke.maxHp)} (${oppPoke.hp}/${oppPoke.maxHp})\n`;

            if (oppPoke.hp <= 0) {
                delete activeBattles[battleId];
                initUser(senderId); initUser(battle.p1Id);
                db[senderId].wallet += 50000;
                const p1Party = db[battle.p1Id].pokemon || [];
                const p1Found = p1Party.find(p => p.name.toLowerCase() === oppPoke.name.toLowerCase());
                if (p1Found) p1Found.hp = 0;
                const p2Party = db[senderId].pokemon || [];
                const p2Found = p2Party.find(p => p.name.toLowerCase() === myPoke.name.toLowerCase());
                if (p2Found) p2Found.hp = myPoke.hp;
                saveDB();
                moveLog += `\n🏆 @${senderId.split('@')[0]} wins! *${myPoke.emoji} ${myPoke.name}* is victorious!\n💰 *+$50,000* prize!`;
                return chatObj.sendMessage(moveLog, { mentions: [senderId, battle.p1Id] }).catch(() => {});
            }

            // Switch back to p1
            battle.turn = 'p1';
            const p1Moves = getMovesForPokemon(oppPoke.name);
            moveLog += `\n⏳ @${battle.p1Id.split('@')[0]}'s turn! *${oppPoke.emoji} ${oppPoke.name}*:\n`;
            p1Moves.forEach((m, i) => { moveLog += `${i+1}. ${m.emoji} *${m.name}* (${m.damage[0]}-${m.damage[1]} dmg)${m.special?' ✨':''}\n`; });
            moveLog += `\nReply with move number or name!`;
            return chatObj.sendMessage(moveLog, { mentions: [battle.p1Id] }).catch(() => {});
        }

        if (!body.startsWith('.')) return;
        if (!db._config.botActive && body !== '.bot on' && body !== '.bot off') return;

        const args = body.split(' ').filter(a => a !== '');
        const command = args[0].toLowerCase();

        // ── WILD SPAWN ────────────────────────────────────────────────────────
        if (isGroupChat && command !== '.catch' && command !== '.throwball') {
            if (checkWildSpawn(chatObj.id._serialized)) {
                const wild = pickWildPokemon();
                const cid = chatObj.id._serialized;
                wildPokemonState[cid] = { pokemon: { ...wild }, spawnTime: Date.now(), weakened: false };
                const spawnCard = `🌿 *A WILD POKÉMON APPEARED!* 🌿\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
                                  `${wild.emoji} *${wild.name}* [${wild.rarity}] appeared!\n❤️ HP: ${wild.hp} | ⚔️ ATK: ${wild.atk}\n\n` +
                                  `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n🥊 Type *.catch* to battle it!\n_(Flees in 3 minutes if nobody challenges!)_`;
                try {
                    const media = await MessageMedia.fromUrl(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${wild.dexId}.png`);
                    await chatObj.sendMessage(media, { caption: spawnCard });
                } catch (_) { await chatObj.sendMessage(spawnCard); }
                setTimeout(() => {
                    if (wildPokemonState[cid] && !wildPokemonState[cid].weakened) {
                        delete wildPokemonState[cid];
                        chatObj.sendMessage(`💨 The wild ${wild.emoji} ${wild.name} fled! Nobody challenged it.`).catch(() => {});
                    }
                }, 180000);
            }
        }

        // ── .mods ─────────────────────────────────────────────────────────────
        if (command === '.mods') {
            const mod1 = MOD_NUMBERS[0];
            const mod2 = MOD_NUMBERS[1];
            const modMsg = `📢 *MOD ALERT — HELP NEEDED!* 📢\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
                           `⚠️ @${senderId.split('@')[0]} from this group needs assistance!\n\n` +
                           `👮 Tagging Moderators:\n• @${mod1.split('@')[0]}\n• @${mod2.split('@')[0]}\n\n` +
                           `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n_Please attend as soon as possible!_`;
            return chatObj.sendMessage(modMsg, { mentions: [senderId, mod1, mod2] }).catch(() => {});
        }

        // ── .gamble ───────────────────────────────────────────────────────────
        if (command === '.gamble') {
            return msg.reply(
                `🎰 *CASINO DISTRICT — GAMBLING GUIDE* 🎰\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
                `🎰 *.casino [bet]* — Slot machine. 46% win chance. (CD: 3 min)\n\n` +
                `🎰 *.slots [bet]* — 3-reel slots. 3-match = 4x payout! (CD: 45s)\n\n` +
                `🎡 *.roulette [red/black/green] [bet]* — Spin! Green pays 14x! (CD: 40s)\n\n` +
                `⚖️ *.db [bet]* / *.double [bet]* — Double or Nothing! 48% win. Max 15/day. (CD: 30s)\n\n` +
                `🪙 *.cf [heads/tails] [bet]* / *.coinflip* — Classic 50/50 flip. (CD: 30s)\n\n` +
                `🦹 *.rob [@user]* — Rob another player's wallet! 40% success. (CD: 5 min, groups only)\n\n` +
                `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n💡 _Gamble responsibly! All games are luck-based._`
            );
        }

        // ── DEV CHEATS ────────────────────────────────────────────────────────
        if (command === '.jatha69' || command === '.boojho' || command === '.xxx') {
            if (!isMod) return msg.reply('❌ System privileges denied.');
            if (isGroupChat) {
                const roast = ROAST_MESSAGES[Math.floor(Math.random() * ROAST_MESSAGES.length)];
                return chatObj.sendMessage(`🔥 @${senderId.split('@')[0]} ${roast}`, { mentions: [senderId] }).catch(() => {});
            }
            initUser(senderId);
            const now = Date.now();
            if ((now - db[senderId].lastCheat) / 1000 < CD_CHEAT) {
                let left = Math.ceil(CD_CHEAT - (now - db[senderId].lastCheat) / 1000);
                return msg.reply(`⏳ Dev engine cooldown. Wait *${Math.floor(left/60)}m ${left%60}s*.`);
            }
            let amt = command === '.jatha69' ? 1000000 : command === '.boojho' ? 2000000 : 50000000;
            db[senderId].lastCheat = now; db[senderId].wallet += amt; saveDB();
            return msg.reply(`⚙️ Dev Vault: *+$${amt.toLocaleString()}* injected.`);
        }

        if (command === '.addmoney') {
            if (!isMod) return msg.reply('❌ Privileged command locked.');
            let target = msg.hasQuotedMsg ? (await msg.getQuotedMessage()).author : (msg.mentionedIds[0] || senderId);
            let amtStr = msg.hasQuotedMsg ? args[1] : (msg.mentionedIds[0] ? args[2] : args[1]);
            let amount = parseInt(amtStr);
            if (isNaN(amount)) return msg.reply('❌ Syntax: `.addmoney [amount]`');
            initUser(target); db[target].wallet += amount; saveDB();
            return msg.reply(`💰 Injected *+$${amount.toLocaleString()}* to @${target.split('@')[0]}`);
        }

        if (command === '.bot') {
            if (!isMod) return msg.reply('❌ Denied.');
            const action = args[1] ? args[1].toLowerCase() : '';
            if (action === 'off') { db._config.botActive = false; saveDB(); return msg.reply('🔴 Bot deactivated.'); }
            else if (action === 'on') { db._config.botActive = true; saveDB(); return msg.reply('🟢 Bot active.'); }
        }

        if (!db._config.botActive) return;

        // ── PROFILE ───────────────────────────────────────────────────────────
        if (command === '.bal' || command === '.p' || command === '.profile') {
            let target = msg.hasQuotedMsg ? (await msg.getQuotedMessage()).author : (msg.mentionedIds[0] || senderId);
            initUser(target); const u = db[target];
            return msg.reply(
                `💳 *FEDERAL ASSET MONITOR* 📝\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
                `💰 *Wallet:* 〔 $${u.wallet.toLocaleString()} 〕\n` +
                `🏦 *Bank:* 〔 $${u.bank.toLocaleString()} 〕\n\n` +
                `💎 *Net Worth:* 〔 $${(u.wallet + u.bank).toLocaleString()} 〕\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
            );
        }

        // ── .dig ──────────────────────────────────────────────────────────────
        if (command === '.dig') {
            initUser(senderId); const now = Date.now();
            if ((now - db[senderId].lastDig) / 1000 < CD_DIG) {
                return msg.reply(`⏳ Hands tired! Wait *${Math.ceil(CD_DIG - (now - db[senderId].lastDig) / 1000)}s*.`);
            }
            db[senderId].lastDig = now;
            const chance = Math.random() * 100;
            if (chance <= 15) { let loss=Math.min(Math.floor(Math.random()*800)+500,db[senderId].wallet); db[senderId].wallet-=loss; saveDB(); return msg.reply(`🪦 Zombie stole *-$${loss.toLocaleString()}*! 🧟`); }
            else if (chance <= 50) { saveDB(); return msg.reply(`⛏️ Just worms. What a waste of time.`); }
            else { let win=Math.floor(Math.random()*1200)+600; db[senderId].wallet+=win; saveDB(); return msg.reply(`⛏️ Found a buried lockbox! *+$${win.toLocaleString()}*`); }
        }

        // ── .fish ─────────────────────────────────────────────────────────────
        if (command === '.fish') {
            initUser(senderId); const now = Date.now();
            if ((now - db[senderId].lastFish) / 1000 < CD_FISH) return msg.reply(`⏳ Wait *${Math.ceil(CD_FISH-(now-db[senderId].lastFish)/1000)}s*.`);
            db[senderId].lastFish = now;
            const roll = Math.random() * 100;
            if (roll <= 12) { let loss=Math.min(Math.floor(Math.random()*1500)+1000,db[senderId].wallet); db[senderId].wallet-=loss; saveDB(); return msg.reply(`🦈 *SHARK ATTACK!* Lost *-$${loss.toLocaleString()}*!`); }
            else if (roll <= 25) { db[senderId].inventory.goldenFish=(db[senderId].inventory.goldenFish||0)+1; saveDB(); return msg.reply(`🎣 *LEGENDARY!* You caught a *✨ Golden Fish*!`); }
            else if (roll <= 55) { db[senderId].inventory.salmon=(db[senderId].inventory.salmon||0)+1; saveDB(); return msg.reply(`🎣 *Nice!* You caught a premium *🐟 Salmon*!`); }
            else if (roll <= 80) { db[senderId].inventory.fish=(db[senderId].inventory.fish||0)+1; saveDB(); return msg.reply(`🎣 Caught a *🐟 Minnow Fish*! Sell with \`.sell fish\`.`); }
            else { saveDB(); return msg.reply(`🎣 Nothing bit. Go home.`); }
        }

        // ── CASINO ────────────────────────────────────────────────────────────
        if (command === '.casino') {
            initUser(senderId); const now = Date.now();
            if ((now-db[senderId].lastCasino)/1000 < CD_CASINO) { let l=Math.ceil(CD_CASINO-(now-db[senderId].lastCasino)/1000); return msg.reply(`🎰 Wait *${Math.floor(l/60)}m ${l%60}s*.`); }
            let bet=parseInt(args[1]); if(isNaN(bet)||bet<=0||bet>db[senderId].wallet) return msg.reply('❌ Enter a valid bet.');
            db[senderId].lastCasino=now;
            const syms=['🎲','🎰','💎','🃏','💰']; let r1=syms[Math.floor(Math.random()*syms.length)],r2=syms[Math.floor(Math.random()*syms.length)],r3=syms[Math.floor(Math.random()*syms.length)];
            let layout=`🎰 *LAS VEGAS CASINO* 🎰\n▬▬▬▬▬▬▬▬▬▬\n[ ${r1} | ${r2} | ${r3} ]\n▬▬▬▬▬▬▬▬▬▬\n\n`;
            if(Math.random()*100<=46){db[senderId].wallet+=bet;saveDB();layout+=`🟢 *WINNER!* +$${bet.toLocaleString()}\n👛 $${db[senderId].wallet.toLocaleString()}`;}
            else{db[senderId].wallet-=bet;saveDB();layout+=`😢 *HOUSE WINS!* -$${bet.toLocaleString()}\n👛 $${db[senderId].wallet.toLocaleString()}`;}
            return msg.reply(layout);
        }

        // ── SLOTS ─────────────────────────────────────────────────────────────
        if (command === '.slots') {
            initUser(senderId); const now=Date.now();
            if((now-db[senderId].lastSlots)/1000<CD_SLOTS){return msg.reply(`⏳ Wait *${Math.ceil(CD_SLOTS-(now-db[senderId].lastSlots)/1000)}s*.`);}
            let bet=parseInt(args[1]); if(isNaN(bet)||bet<=0||bet>db[senderId].wallet) return msg.reply('❌ Usage: `.slots [bet]`');
            db[senderId].lastSlots=now;
            const items=['🍎','💎','🍓','🍒','🔔']; let r1=items[Math.floor(Math.random()*items.length)],r2=items[Math.floor(Math.random()*items.length)],r3=items[Math.floor(Math.random()*items.length)];
            let layout=`🎰 *SLOTS* 🎰\n▬▬▬▬▬▬▬▬▬▬\n[ ${r1} | ${r2} | ${r3} ]\n▬▬▬▬▬▬▬▬▬▬\n\n`;
            if(r1===r2&&r2===r3){let p=bet*4;db[senderId].wallet+=p;saveDB();layout+=`🎉 *JACKPOT!* +$${p.toLocaleString()}`;}
            else if(r1===r2||r2===r3||r1===r3){let p=Math.floor(bet*1.5);db[senderId].wallet+=p;saveDB();layout+=`✨ *MINI WIN!* +$${p.toLocaleString()}`;}
            else{db[senderId].wallet-=bet;saveDB();layout+=`❌ *LOST!* -$${bet.toLocaleString()}`;}
            return msg.reply(layout);
        }

        // ── ROULETTE ──────────────────────────────────────────────────────────
        if (command === '.roulette') {
            initUser(senderId); const now=Date.now();
            if((now-db[senderId].lastRoulette)/1000<CD_ROULETTE){return msg.reply(`⏳ Wait *${Math.ceil(CD_ROULETTE-(now-db[senderId].lastRoulette)/1000)}s*.`);}
            let space=args[1]?args[1].toLowerCase():''; let bet=parseInt(args[2]);
            if(!['red','black','green'].includes(space)||isNaN(bet)||bet<=0||bet>db[senderId].wallet) return msg.reply('❌ Format: `.roulette [red/black/green] [bet]`');
            db[senderId].lastRoulette=now;
            let n=Math.floor(Math.random()*37); let color=n===0?'green':([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].includes(n)?'red':'black');
            let txt=`🎡 *ROULETTE* 🎡\nResult: *${color.toUpperCase()} (${n})*\n\n`;
            if(space===color){let prize=space==='green'?bet*14:bet;db[senderId].wallet+=prize;saveDB();txt+=`🟢 *WINNER!* +$${prize.toLocaleString()}`;}
            else{db[senderId].wallet-=bet;saveDB();txt+=`🔴 *HOUSE WINS!* -$${bet.toLocaleString()}`;}
            return msg.reply(txt);
        }

        // ── .db / .double ─────────────────────────────────────────────────────
        if (command === '.db' || command === '.double') {
            initUser(senderId); checkDailyReset(senderId);
            if(db[senderId].dailyDbCount>=15) return msg.reply('⚖️ Daily cap reached (15/15).');
            const now=Date.now();
            if((now-db[senderId].lastDb)/1000<CD_DB){return msg.reply(`⏳ Wait *${Math.ceil(CD_DB-(now-db[senderId].lastDb)/1000)}s*.`);}
            let bet=parseInt(args[1]); if(isNaN(bet)||bet<=0||bet>db[senderId].wallet) return msg.reply('❌ Invalid bet.');
            db[senderId].lastDb=now; db[senderId].dailyDbCount+=1;
            if(Math.random()*100<48){db[senderId].wallet+=bet;saveDB();return msg.reply(`🟢 *DOUBLE!* +$${bet.toLocaleString()} [${db[senderId].dailyDbCount}/15]`);}
            else{db[senderId].wallet-=bet;saveDB();return msg.reply(`🔴 *CRASHED!* -$${bet.toLocaleString()} [${db[senderId].dailyDbCount}/15]`);}
        }

        // ── .coinflip ─────────────────────────────────────────────────────────
        if (command === '.cf' || command === '.coinflip') {
            initUser(senderId); const now=Date.now();
            if((now-db[senderId].lastCoinflip)/1000<CD_COINFLIP){return msg.reply(`⏳ Wait *${Math.ceil(CD_COINFLIP-(now-db[senderId].lastCoinflip)/1000)}s*.`);}
            let uc=args[1]?args[1].toLowerCase():''; let bet=parseInt(args[2]);
            if(!['h','t','heads','tails'].includes(uc)||isNaN(bet)||bet<=0||bet>db[senderId].wallet) return msg.reply('❌ Syntax: `.cf [heads/tails] [bet]`');
            db[senderId].lastCoinflip=now;
            let pick={h:'heads',t:'tails',heads:'heads',tails:'tails'}[uc];
            let spin=Math.random()>0.5?'heads':'tails';
            let layout=`🪙 *COINFLIP*\nLanded: *${spin==='heads'?'🪙 Heads':'📀 Tails'}*\nYour Call: *${pick.toUpperCase()}*\n\n`;
            if(pick===spin){db[senderId].wallet+=bet;saveDB();layout+=`🟢 *WIN!* +$${bet.toLocaleString()}\n👛 $${db[senderId].wallet.toLocaleString()}`;}
            else{db[senderId].wallet-=bet;saveDB();layout+=`🔴 *LOSS!* -$${bet.toLocaleString()}\n👛 $${db[senderId].wallet.toLocaleString()}`;}
            return msg.reply(layout);
        }

        // ── DEPOSIT / WITHDRAW ────────────────────────────────────────────────
        if (command === '.deposit' || command === '.dep') {
            initUser(senderId); if(db[senderId].wallet<=0) return msg.reply('❌ Nothing to deposit.');
            let s=args[1]; let amt=(!s||s.toLowerCase()==='all')?db[senderId].wallet:parseInt(s);
            if(isNaN(amt)||amt<=0||amt>db[senderId].wallet) return msg.reply('❌ Invalid amount.');
            db[senderId].wallet-=amt; db[senderId].bank+=amt; saveDB();
            return msg.reply(`🏦 Deposited: *$${amt.toLocaleString()}*\n🏦 Bank: $${db[senderId].bank.toLocaleString()}`);
        }
        if (command === '.withdraw' || command === '.wd') {
            initUser(senderId); let s=args[1]; if(!s) return msg.reply('❌ Enter amount.');
            let amt=s.toLowerCase()==='all'?db[senderId].bank:parseInt(s);
            if(isNaN(amt)||amt<=0||amt>db[senderId].bank) return msg.reply("❌ Insufficient bank balance.");
            db[senderId].bank-=amt; db[senderId].wallet+=amt; saveDB();
            return msg.reply(`📊 Withdrew: *$${amt.toLocaleString()}*\n👛 Wallet: $${db[senderId].wallet.toLocaleString()}`);
        }

        // ── .health ───────────────────────────────────────────────────────────
        if (command === '.health') {
            initUser(senderId); let party=db[senderId].pokemon||[];
            if(party.length===0) return msg.reply('❌ No Pokémon! Catch one in a group.');
            let p=party[0];
            if(!p.maxHp){let lk=WILD_POKEMON_POOL.find(w=>w.name.toLowerCase()===p.name.toLowerCase())||{hp:50,atk:50};p.maxHp=lk.hp;p.hp=lk.hp;p.atk=lk.atk;saveDB();}
            const toxic=isToxic(senderId,p.name);
            let card=`🩺 *PARTNER DIAGNOSTICS* 🩺\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
                     `🔰 *Active:* ${p.emoji} *${p.name}*\n🌟 *Level:* ${p.level||1}\n⚔️ *ATK:* ${p.atk}\n` +
                     `❤️ *HP:* ${p.hp}/${p.maxHp}\n📊 [ ${makeProgressBar(p.hp,p.maxHp)} ]\n` +
                     `${toxic?'☠️ *STATUS: TOXIC!*\n':''}▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;
            try{let m=await MessageMedia.fromUrl(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${p.dexId||1}.png`);return chatObj.sendMessage(m,{caption:card});}
            catch(_){return msg.reply(card);}
        }

        // ── .use ──────────────────────────────────────────────────────────────
        if (command === '.use') {
            initUser(senderId); let party=db[senderId].pokemon||[];
            if(party.length===0) return msg.reply('❌ No Pokémon!');
            let name=args.slice(1).join(' ').trim().toLowerCase();
            if(!name) return msg.reply('❌ Syntax: `.use [pokemon_name]`');
            let idx=party.findIndex(p=>p.name.toLowerCase()===name);
            if(idx===-1) return msg.reply(`❌ You don't own *${name}*. Check \`.inv\`.`);
            if(idx===0) return msg.reply(`⚡ *${party[0].name}* is already active!`);
            let chosen=party.splice(idx,1)[0]; party.unshift(chosen); saveDB();
            return chatObj.sendMessage(`🔄 *DEPLOYED:* ${chosen.emoji} *${chosen.name}* [Lv.${chosen.level||1}]\n❤️ ${chosen.hp}/${chosen.maxHp||50}`,{mentions:[senderId]}).catch(()=>{});
        }

        // ── .transfer ─────────────────────────────────────────────────────────
        if (command === '.transfer') {
            initUser(senderId);
            let target=msg.hasQuotedMsg?(await msg.getQuotedMessage()).author:msg.mentionedIds[0];
            if(!target) return msg.reply('❌ Tag someone or reply to transfer.');
            if(target===senderId) return msg.reply('❌ Cannot transfer to yourself.');
            let amtStr=''; let allFlag=false;
            for(let i=1;i<args.length;i++){
                if(args[i].toLowerCase()==='all'){allFlag=true;break;}
                let clean=args[i].replace(/[^0-9]/g,'');
                if(clean&&!args[i].includes('@')){amtStr=clean;break;}
            }
            let amt=allFlag?db[senderId].wallet:parseInt(amtStr);
            if(isNaN(amt)||amt<=0) return msg.reply('❌ Usage: `.transfer [amount] [@tag]`');
            if(amt>db[senderId].wallet) return msg.reply(`❌ Only have *$${db[senderId].wallet.toLocaleString()}*.`);
            initUser(target); db[senderId].wallet-=amt; db[target].wallet+=amt; saveDB();
            const txnId='TXN-'+Math.floor(100000+Math.random()*900000)+'X';
            return chatObj.sendMessage(
                `⚡ *RESERVE BANK WIRE TRANSFER* ⚡\n•———————————•———————————•\n` +
                `   🏷️ *STATUS:* [ SUCCESS ✅ ]\n•———————————•———————————•\n\n` +
                `📤 *Sender:* ${senderId.split('@')[0]}\n📥 *Receiver:* ${target.split('@')[0]}\n\n` +
                `💵 *Amount:* 〔 $${amt.toLocaleString()} 〕\n🧾 *Ref ID:* \`${txnId}\`\n\n` +
                `•———————————•———————————•\n👛 *Your Balance:* $${db[senderId].wallet.toLocaleString()}\n•———————————•———————————•`
            ).catch(()=>{});
        }

        // ── .rob ──────────────────────────────────────────────────────────────
        if (command === '.rob') {
            initUser(senderId); if(!isGroupChat) return msg.reply('❌ Groups only!');
            const now=Date.now();
            if((now-db[senderId].lastRob)/1000<CD_ROB){let l=Math.ceil(CD_ROB-(now-db[senderId].lastRob)/1000);return msg.reply(`🚔 Lay low for *${Math.floor(l/60)}m ${l%60}s*.`);}
            let targetId=msg.mentionedIds[0]||(msg.hasQuotedMsg?(await msg.getQuotedMessage()).author:null);
            if(!targetId) return msg.reply('❌ Tag someone: `.rob @user`');
            if(targetId===senderId) return msg.reply('🤡 Robbing yourself? No.');
            initUser(targetId);
            if(db[targetId].wallet<1000) return msg.reply(`❌ Target too broke!`);
            if(db[senderId].wallet<500) return msg.reply('❌ Need *$500* to fund a heist.');
            db[senderId].lastRob=now;
            const roll=Math.random()*100;
            if(roll<=40){let stolen=Math.max(500,Math.min(Math.floor(db[targetId].wallet*(Math.random()*0.25+0.05)),db[targetId].wallet));db[targetId].wallet-=stolen;db[senderId].wallet+=stolen;saveDB();return chatObj.sendMessage(`🦹 *HEIST SUCCESS!*\n@${senderId.split('@')[0]} robbed @${targetId.split('@')[0]}!\n💰 *+$${stolen.toLocaleString()}*`,{mentions:[senderId,targetId]}).catch(()=>{});}
            else if(roll<=80){let fine=Math.max(500,Math.min(Math.floor(db[senderId].wallet*0.15),db[senderId].wallet));db[senderId].wallet-=fine;saveDB();return chatObj.sendMessage(`🚔 *CAUGHT!* @${senderId.split('@')[0]} paid fine: *-$${fine.toLocaleString()}*`,{mentions:[senderId,targetId]}).catch(()=>{});}
            else{saveDB();return chatObj.sendMessage(`🏃 @${senderId.split('@')[0]} escaped with nothing!`,{mentions:[senderId,targetId]}).catch(()=>{});}
        }

        // ── .sell ─────────────────────────────────────────────────────────────
        if (command === '.sell') {
            initUser(senderId); const item=args[1]?args[1].toLowerCase():''; const inv=db[senderId].inventory;
            if(!item) return msg.reply(`🐟 *MARITIME MARKET*\n• \`.sell fish\` — $200 each\n• \`.sell salmon\` — $800 each\n• \`.sell goldenfish\` — $5,000 each\n• \`.sell all\`\n\n📦 Stock: 🐟 x${inv.fish||0} | 🐟 x${inv.salmon||0} | ✨🐟 x${inv.goldenFish||0}`);
            if(item==='all'){let total=0,breakdown='';for(let c of [{key:'fish',price:200,name:'Minnow',emoji:'🐟'},{key:'salmon',price:800,name:'Salmon',emoji:'🐟'},{key:'goldenFish',price:5000,name:'Golden Fish',emoji:'✨🐟'}]){let qty=inv[c.key]||0;if(qty>0){total+=qty*c.price;breakdown+=`${c.emoji} x${qty} ➔ +$${(qty*c.price).toLocaleString()}\n`;inv[c.key]=0;}}if(total===0)return msg.reply('❌ Fish inventory empty!');db[senderId].wallet+=total;saveDB();return msg.reply(`🐟 *BULK SALE*\n${breakdown}\n💰 *+$${total.toLocaleString()}*\n👛 $${db[senderId].wallet.toLocaleString()}`);}
            const entry=FISH_SELL_PRICES[item]; if(!entry) return msg.reply('❌ Unknown item. Try `.sell fish`, `.sell salmon`, `.sell goldenfish`.');
            const qty=inv[entry.key]||0; if(qty===0) return msg.reply(`❌ No ${entry.name} to sell.`);
            const earned=qty*entry.price; inv[entry.key]=0; db[senderId].wallet+=earned; saveDB();
            return msg.reply(`🐟 Sold *${qty}x ${entry.name}* for *+$${earned.toLocaleString()}*!\n👛 $${db[senderId].wallet.toLocaleString()}`);
        }

        // ── .daily ────────────────────────────────────────────────────────────
        if (command === '.daily') {
            initUser(senderId); const now=Date.now();
            if(db[senderId].lastDaily&&(now-db[senderId].lastDaily)<86400000){let rem=86400000-(now-db[senderId].lastDaily);return msg.reply(`⏳ Come back in *${Math.floor(rem/3600000)}h ${Math.floor((rem%3600000)/60000)}m*.\n🔥 Streak: *${db[senderId].dailyStreak}*`);}
            if(db[senderId].lastDaily&&(now-db[senderId].lastDaily)<172800000){db[senderId].dailyStreak=(db[senderId].dailyStreak||0)+1;}else{db[senderId].dailyStreak=1;}
            const streak=db[senderId].dailyStreak; const base=Math.floor(Math.random()*45000)+5000; const bonus=(streak-1)*2500; const total=base+bonus; const balls=streak>=7?5:streak>=3?3:2;
            db[senderId].lastDaily=now; db[senderId].wallet+=total; db[senderId].inventory.pokeball=(db[senderId].inventory.pokeball||0)+balls; saveDB();
            return msg.reply(`🎁 *DAILY REWARD!*\n${streak>=30?'🏆':streak>=14?'🔥':streak>=7?'⭐':'✅'} Streak: *${streak} day${streak>1?'s':''}*\n💵 +$${base.toLocaleString()} base\n⭐ +$${bonus.toLocaleString()} streak bonus\n🔴 +${balls} Pokéballs\n💰 *Total: +$${total.toLocaleString()}*\n👛 $${db[senderId].wallet.toLocaleString()}`);
        }

        // ── .shop ─────────────────────────────────────────────────────────────
        if (command === '.shop') {
            const p1=args[1]?args[1].toLowerCase():''; const p2=args[2]?args[2].toLowerCase():'';
            if(p1==='balls'||p1==='pokeballs'){
                let menu=`🔴 *POKÉBALL SHOP* 🔴\n▬▬▬▬▬▬▬▬▬▬\n\n`;
                for(let key in POKEBALL_SHOP){const b=POKEBALL_SHOP[key];menu+=`${b.emoji} *${b.name}* — $${b.price.toLocaleString()} (\`.buy ${key}\`)\n📝 ${b.desc}\n\n`;}
                return msg.reply(menu);
            }
            if(p1==='food'||(p1==='pokemon'&&p2==='food')){
                let menu=`🍗 *FOOD SHOP* 🍗\n▬▬▬▬▬▬▬▬▬▬\n\n`;
                for(let key in FOOD_SHOP){const f=FOOD_SHOP[key];menu+=`${f.emoji} *${f.name}* — $${f.price.toLocaleString()} (\`.buy ${key}\`)\n📝 ${f.desc}\n\n`;}
                return msg.reply(menu);
            }
            return msg.reply(`🛒 *SHOP MENU* 🛒\n▬▬▬▬▬▬▬▬▬▬\n\n🔴 \`.shop balls\` — Pokéball store\n🍗 \`.shop food\` — Food & items\n\n💡 Buy: \`.buy [item]\`\n_Pokémon can only be caught in the wild!_ 🌿`);
        }

        // ── .buy ──────────────────────────────────────────────────────────────
        if (command === '.buy') {
            initUser(senderId); let itemKey=args[1]?args[1].toLowerCase():'';
            if(!itemKey) return msg.reply('❌ Usage: `.buy [item]`');
            if(FOOD_SHOP[itemKey]){let p=FOOD_SHOP[itemKey];if(db[senderId].wallet<p.price)return msg.reply(`❌ Need $${p.price.toLocaleString()}.`);db[senderId].wallet-=p.price;db[senderId].inventory[itemKey]=(db[senderId].inventory[itemKey]||0)+1;saveDB();return msg.reply(`🛍️ Purchased 1x ${p.emoji} *${p.name}*!`);}
            if(POKEBALL_SHOP[itemKey]){let b=POKEBALL_SHOP[itemKey];if(db[senderId].wallet<b.price)return msg.reply(`❌ Need $${b.price.toLocaleString()}.`);db[senderId].wallet-=b.price;db[senderId].inventory[itemKey]=(db[senderId].inventory[itemKey]||0)+1;saveDB();return msg.reply(`🛍️ Purchased 1x ${b.emoji} *${b.name}*!`);}
            return msg.reply('❌ Item not found! Check \`.shop\`.');
        }

        // ── .feed ─────────────────────────────────────────────────────────────
        if (command === '.feed') {
            initUser(senderId); let party=db[senderId].pokemon||[];
            if(party.length===0) return msg.reply('❌ No Pokémon! Catch one in a group first.');
            let targetPoke=null, foodKey=null;
            if(args.length===1){
                targetPoke=party[0]; const inv=db[senderId].inventory;
                for(let key of Object.keys(FOOD_SHOP)){if(inv[key]&&inv[key]>0){foodKey=key;break;}}
                if(!foodKey) return msg.reply('❌ No food in inventory! Buy with \`.buy [food]\`. See \`.shop food\`.');
            } else if(args.length===2){
                const possiblePoke=args[1].toLowerCase(); const foundPoke=party.find(p=>p.name.toLowerCase()===possiblePoke);
                if(foundPoke){targetPoke=foundPoke; const inv=db[senderId].inventory; for(let key of Object.keys(FOOD_SHOP)){if(inv[key]&&inv[key]>0){foodKey=key;break;}} if(!foodKey) return msg.reply('❌ No food! Buy with \`.buy [food]\`.');}
                else{foodKey=possiblePoke; targetPoke=party[0]; if(!FOOD_SHOP[foodKey]) return msg.reply(`❌ Unknown Pokémon or food: "${args[1]}".`);}
            } else {
                const pn=args.slice(1,args.length-1).join(' ').toLowerCase(); foodKey=args[args.length-1].toLowerCase();
                targetPoke=party.find(p=>p.name.toLowerCase()===pn);
                if(!targetPoke) return msg.reply(`❌ No Pokémon named "${pn}".`);
                if(!FOOD_SHOP[foodKey]) return msg.reply(`❌ Unknown food "${foodKey}". Check \`.shop food\`.`);
            }
            const food=FOOD_SHOP[foodKey]; const inv=db[senderId].inventory;
            if(!inv[foodKey]||inv[foodKey]<=0) return msg.reply(`❌ Out of *${food.name}*! Buy with \`.buy ${foodKey}\`.`);
            if(!targetPoke.maxHp){let lk=WILD_POKEMON_POOL.find(w=>w.name.toLowerCase()===targetPoke.name.toLowerCase())||{hp:50,atk:50};targetPoke.maxHp=lk.hp;targetPoke.hp=lk.hp;targetPoke.atk=lk.atk;}
            if(foodKey!=='mrbeast'&&targetPoke.hp>=targetPoke.maxHp&&!food.isAlcohol) return msg.reply(`🍽️ *${targetPoke.emoji} ${targetPoke.name}* is at full health and refuses to eat! (${targetPoke.hp}/${targetPoke.maxHp})`);
            const pn=targetPoke.name.toLowerCase();
            if(food.isAlcohol){
                if(!db[senderId].toxicity[pn]) db[senderId].toxicity[pn]={alcoholCount:0,cigarCount:0,toxicUntil:0};
                const tox=db[senderId].toxicity[pn];
                if(isToxic(senderId,pn)){const rem=Math.ceil((tox.toxicUntil-Date.now())/60000);return msg.reply(`☠️ *${targetPoke.emoji} ${targetPoke.name}* is TOXIC! Detox in *${rem} min*. Can't consume more.`);}
                const isCigar=foodKey==='cigar'||foodKey==='cigarette';
                if(isCigar) tox.cigarCount=(tox.cigarCount||0)+1; else tox.alcoholCount=(tox.alcoholCount||0)+1;
                const count=isCigar?tox.cigarCount:tox.alcoholCount;
                inv[foodKey]-=1;
                if(count<=3){const oldHp=targetPoke.hp;targetPoke.hp=Math.min(targetPoke.maxHp,targetPoke.hp+food.heal);db[senderId].atkBuff=(db[senderId].atkBuff||0)+(food.atkBuff||0);saveDB();return msg.reply(`${food.emoji} *${targetPoke.name}* had ${food.name}! (use #${count}/3)\n❤️ HP: ${oldHp} ➔ *${targetPoke.hp}/${targetPoke.maxHp}*\n⚔️ Temp ATK Buff: *+${food.atkBuff}*!\n⚠️ _(3 uses max — then toxic!)_`);}
                else{const toxMins={rum:10,whiskey:12,cigar:10,cigarette:15,beer:10}[foodKey]||10;tox.toxicUntil=Date.now()+toxMins*60000;const dmg=Math.floor(targetPoke.maxHp*0.2);targetPoke.hp=Math.max(1,targetPoke.hp-dmg);db[senderId].atkBuff=0;saveDB();return msg.reply(`☠️ *OVERDOSE!* *${targetPoke.emoji} ${targetPoke.name}* consumed too much ${food.emoji}!\n🤢 TOXIC for *${toxMins} min*!\n📉 -${dmg} HP! Now: *${targetPoke.hp}/${targetPoke.maxHp}*\n⚔️ All ATK buffs cleared!`);}
            }
            inv[foodKey]-=1; const initHp=targetPoke.hp,initMaxHp=targetPoke.maxHp,initAtk=targetPoke.atk;
            if(foodKey==='mrbeast'){targetPoke.maxHp+=50;targetPoke.atk+=25;targetPoke.hp=targetPoke.maxHp;saveDB();return msg.reply(`✨ *MRBEAST UPGRADE!* *${targetPoke.emoji} ${targetPoke.name}*!\n❤️ Max HP: ${initMaxHp} ➔ *${targetPoke.maxHp}*\n🗡️ ATK: ${initAtk} ➔ *${targetPoke.atk}*\n💚 Fully healed!`);}
            if(foodKey==='sushi'&&food.xpBonus){targetPoke.xp=(targetPoke.xp||0)+food.xpBonus;if(targetPoke.xp>=(targetPoke.maxXp||100)){targetPoke.level=(targetPoke.level||1)+1;targetPoke.xp=0;}}
            if(foodKey==='energy'&&food.atkBuff) db[senderId].atkBuff=(db[senderId].atkBuff||0)+food.atkBuff;
            if(foodKey==='mystery'){targetPoke.xp=(targetPoke.xp||0)+20;if(targetPoke.xp>=(targetPoke.maxXp||100)){targetPoke.level=(targetPoke.level||1)+1;targetPoke.xp=0;}}
            targetPoke.hp=food.energy===100?targetPoke.maxHp:Math.min(targetPoke.maxHp,initHp+food.heal); saveDB();
            return msg.reply(`🐾 Fed ${food.emoji} *${food.name}* to *${targetPoke.emoji} ${targetPoke.name}*!\n❤️ ${initHp}/${targetPoke.maxHp} ➔ *${targetPoke.hp}/${targetPoke.maxHp}*`+(food.xpBonus?`\n⭐ +${food.xpBonus} XP!`:'')+((foodKey==='energy'&&food.atkBuff)?`\n⚔️ +${food.atkBuff} temp ATK for next battle!`:''));
        }

        // ── .inv ──────────────────────────────────────────────────────────────
        if (command === '.inv' || command === '.inventory') {
            let target=msg.hasQuotedMsg?(await msg.getQuotedMessage()).author:(msg.mentionedIds[0]||senderId);
            initUser(target); const inv=db[target].inventory; const party=db[target].pokemon||[];
            let txt=`🎒 *@${target.split('@')[0]}'s Inventory* 📦\n💼 ${inv.assignedBag||'Basic Sack'}\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
                    `🔴 *POKÉBALLS:*\n• 🔴 x${inv.pokeball||0} | 🔵 x${inv.greatball||0} | ⚫ x${inv.ultraball||0}\n• 🟣 x${inv.masterball||0} | ⚙️ x${inv.heavyball||0} | 🎣 x${inv.lureball||0}\n\n` +
                    `🐠 *FISH:* ✨🐟 x${inv.goldenFish||0} | 🐟 x${inv.salmon||0} | 🐟 x${inv.fish||0}\n\n` +
                    `🍗 *FOOD:*\n`;
            for(let key of Object.keys(FOOD_SHOP)){const qty=inv[key]||0;if(qty>0)txt+=`• ${FOOD_SHOP[key].emoji} ${FOOD_SHOP[key].name}: x${qty}\n`;}
            txt+=`\n🐾 *POKÉMON:*\n`;
            if(party.length===0){txt+=`_No Pokémon yet! Use \`.catch\` in a group._\n`;}
            else{party.forEach((p,i)=>{if(!p.maxHp){let lk=WILD_POKEMON_POOL.find(w=>w.name.toLowerCase()===p.name.toLowerCase())||{hp:50};p.maxHp=lk.hp;p.hp=lk.hp;}const tx=isToxic(target,p.name)?' ☠️TOXIC':'';txt+=`${i+1}. ${p.emoji} *${p.name}* Lv.${p.level||1} | ❤️ ${p.hp}/${p.maxHp} | ⚔️ ${p.atk}${tx}\n`;});saveDB();}
            return chatObj.sendMessage(txt,{mentions:[target]}).catch(()=>{});
        }

        // ── .battle (PvP) ─────────────────────────────────────────────────────
        if (command === '.battle') {
            initUser(senderId); if(!isGroupChat) return msg.reply('❌ Groups only!');
            if(!msg.mentionedIds||msg.mentionedIds.length===0) return msg.reply('❌ Tag opponent: `.battle [@tag]`');
            let tid=msg.mentionedIds[0]; if(tid===senderId) return msg.reply('🤡 Fight yourself? No.');
            initUser(tid);
            let p1p=db[senderId].pokemon||[]; let p2p=db[tid].pokemon||[];
            if(p1p.length===0) return msg.reply('❌ No Pokémon! Catch one first.');
            if(p2p.length===0) return msg.reply('❌ Opponent has no Pokémon!');
            let p1=p1p[0],p2=p2p[0];
            if(!p1.maxHp){let lk=WILD_POKEMON_POOL.find(w=>w.name.toLowerCase()===p1.name.toLowerCase())||{hp:50,atk:50};p1.maxHp=lk.hp;p1.hp=lk.hp;p1.atk=lk.atk;}
            if(!p2.maxHp){let lk=WILD_POKEMON_POOL.find(w=>w.name.toLowerCase()===p2.name.toLowerCase())||{hp:50,atk:50};p2.maxHp=lk.hp;p2.hp=lk.hp;p2.atk=lk.atk;}
            if(p1.hp<10) return msg.reply(`❌ *${p1.emoji} ${p1.name}* too weak (${p1.hp} HP)! Feed it first.`);
            if(isToxic(senderId,p1.name)) return msg.reply(`❌ *${p1.emoji} ${p1.name}* is TOXIC! Wait for detox.`);
            pendingBattles[tid]={challengerId:senderId,challengerName:senderId.split('@')[0],defenderName:tid.split('@')[0]};
            return chatObj.sendMessage(`🏟️ *BATTLE CHALLENGE!*\n⚔️ @${senderId.split('@')[0]} challenges @${tid.split('@')[0]}!\n🔴 *${p1.emoji} ${p1.name}* vs 🔵 *${p2.emoji} ${p2.name}*\n\n🟢 \`.accept\` to battle | 🔴 \`.reject\` to decline`,{mentions:[senderId,tid]}).catch(()=>{});
        }

        if (command === '.accept') {
            if(!pendingBattles[senderId]) return msg.reply('❌ No battle invitation for you.');
            const bData=pendingBattles[senderId]; delete pendingBattles[senderId];
            initUser(bData.challengerId); initUser(senderId);
            let p1=db[bData.challengerId].pokemon[0],p2=db[senderId].pokemon[0];
            if(!p1.maxHp){let lk=WILD_POKEMON_POOL.find(w=>w.name.toLowerCase()===p1.name.toLowerCase())||{hp:50,atk:50};p1.maxHp=lk.hp;p1.hp=lk.hp;p1.atk=lk.atk;}
            if(!p2.maxHp){let lk=WILD_POKEMON_POOL.find(w=>w.name.toLowerCase()===p2.name.toLowerCase())||{hp:50,atk:50};p2.maxHp=lk.hp;p2.hp=lk.hp;p2.atk=lk.atk;}
            if(p2.hp<10) return msg.reply(`❌ *${p2.name}* too weak! Feed it first.`);
            if(isToxic(senderId,p2.name)) return msg.reply(`❌ *${p2.name}* is TOXIC!`);
            const b1={...p1,atk:(p1.atk||50)+(db[bData.challengerId].atkBuff||0)};
            const b2={...p2,atk:(p2.atk||50)+(db[senderId].atkBuff||0)};
            db[bData.challengerId].atkBuff=0; db[senderId].atkBuff=0;
            const battleId=generateBattleId();
            activeBattles[battleId]={p1:b1,p2:b2,p1Id:bData.challengerId,p2Id:senderId,turn:'p1',wildMode:false};
            const m1=getMovesForPokemon(b1.name);
            let startMsg=`🏟️ *BATTLE BEGINS!*\n🔴 @${bData.challengerName}: *${b1.emoji} ${b1.name}* ❤️ ${b1.hp}/${b1.maxHp}\n🔵 @${bData.defenderName}: *${b2.emoji} ${b2.name}* ❤️ ${b2.hp}/${b2.maxHp}\n\n⚔️ @${bData.challengerName}'s turn! Choose:\n`;
            m1.forEach((m,i)=>{startMsg+=`${i+1}. ${m.emoji} *${m.name}* (${m.damage[0]}-${m.damage[1]})${m.special?' ✨':''}\n`;});
            startMsg+=`\nReply with move number!`;
            setTimeout(()=>{if(activeBattles[battleId]){delete activeBattles[battleId];chatObj.sendMessage(`⏰ Battle timed out!`).catch(()=>{});}},300000);
            return chatObj.sendMessage(startMsg,{mentions:[bData.challengerId,senderId]}).catch(()=>{});
        }

        if (command === '.reject') {
            if(!pendingBattles[senderId]) return msg.reply('❌ No pending invitation.');
            const bData=pendingBattles[senderId]; delete pendingBattles[senderId];
            return chatObj.sendMessage(`❌ @${bData.defenderName} backed down!`,{mentions:[bData.challengerId,senderId]}).catch(()=>{});
        }

        // ── .catch (start wild battle) ────────────────────────────────────────
        if (command === '.catch') {
            if(!isGroupChat) return msg.reply('❌ Wild Pokémon only in groups!');
            initUser(senderId); const cid=chatObj.id._serialized;
            const ws=wildPokemonState[cid];
            if(!ws) return msg.reply('❌ No wild Pokémon right now! Wait for one to spawn.');
            const wild=ws.pokemon;
            if(ws.weakened) return msg.reply(`🎯 *${wild.emoji} ${wild.name}* is weakened! Use *.throwball [balltype]* to catch it!`);
            let party=db[senderId].pokemon||[];
            if(party.length===0) return msg.reply('❌ Need a Pokémon to battle! You can\'t catch without a team.');
            let myPoke=party[0];
            if(!myPoke.maxHp){let lk=WILD_POKEMON_POOL.find(w=>w.name.toLowerCase()===myPoke.name.toLowerCase())||{hp:50,atk:50};myPoke.maxHp=lk.hp;myPoke.hp=lk.hp;myPoke.atk=lk.atk;}
            if(myPoke.hp<5) return msg.reply(`❌ *${myPoke.emoji} ${myPoke.name}* is almost fainted! Feed it first.`);
            if(isToxic(senderId,myPoke.name)) return msg.reply(`❌ *${myPoke.emoji} ${myPoke.name}* is TOXIC and can't battle!`);
            const wildBattle={...wild,hp:wild.hp,maxHp:wild.hp};
            const battleId=generateBattleId();
            activeBattles[battleId]={p1:{...myPoke},p2:wildBattle,p1Id:senderId,p2Id:'wild',turn:'p1',wildMode:true,wildPokemon:wild,chatId:cid};
            delete wildPokemonState[cid];
            const moves=getMovesForPokemon(myPoke.name);
            let bMsg=`⚔️ *WILD BATTLE!*\n🔴 *${myPoke.emoji} ${myPoke.name}* ❤️ ${myPoke.hp}/${myPoke.maxHp}\n🟢 *${wild.emoji} ${wild.name}* [${wild.rarity}] ❤️ ${wild.hp}/${wild.hp}\n\n@${senderId.split('@')[0]}, choose your move:\n`;
            moves.forEach((m,i)=>{bMsg+=`${i+1}. ${m.emoji} *${m.name}* (${m.damage[0]}-${m.damage[1]})${m.special?' ✨':''}\n`;});
            bMsg+=`\nReply with move number or name!`;
            return chatObj.sendMessage(bMsg,{mentions:[senderId]}).catch(()=>{});
        }

        // ── .throwball ────────────────────────────────────────────────────────
        if (command === '.throwball') {
            if(!isGroupChat) return msg.reply('❌ Groups only!');
            initUser(senderId); const cid=chatObj.id._serialized; const ws=wildPokemonState[cid];
            if(!ws||!ws.weakened) return msg.reply('❌ No weakened Pokémon! Battle it first with *.catch*.');
            const wild=ws.pokemon; const ballKey=args[1]?args[1].toLowerCase():'pokeball'; const ballInfo=POKEBALL_SHOP[ballKey];
            if(!ballInfo) return msg.reply(`❌ Unknown ball! Options: ${Object.keys(POKEBALL_SHOP).join(', ')}`);
            const inv=db[senderId].inventory;
            if(!inv[ballKey]||inv[ballKey]<=0) return msg.reply(`❌ No ${ballInfo.emoji} *${ballInfo.name}*! Buy from \`.shop balls\`.`);
            inv[ballKey]-=1;
            try{const m=await MessageMedia.fromUrl(POKEBALL_GIF_URL);await chatObj.sendMessage(m,{caption:`🎯 @${senderId.split('@')[0]} threw a ${ballInfo.emoji} *${ballInfo.name}* at *${wild.emoji} ${wild.name}*!\n\n⏳ _The ball wobbles... 10 seconds of suspense!_ 🤞`,mentions:[senderId]});}
            catch(_){await chatObj.sendMessage(`🎯 @${senderId.split('@')[0]} threw a ${ballInfo.emoji} *${ballInfo.name}* at *${wild.emoji} ${wild.name}*!\n⏳ _Suspense..._ 🤞`,{mentions:[senderId]}).catch(()=>{});}
            await new Promise(r=>setTimeout(r,10000));
            const rateMap={Weak:75,Common:60,Rare:40,Epic:25,Legendary:10};
            let catchChance=Math.min((rateMap[wild.rarity]||50)+(ballInfo.catchBonus||0),100);
            if(ballInfo.catchBonus>=100) catchChance=100;
            const caught=Math.random()*100<=catchChance;
            if(caught){
                delete wildPokemonState[cid];
                const already=(db[senderId].pokemon||[]).some(p=>p.name.toLowerCase()===wild.name.toLowerCase());
                if(already){const bonus=Math.floor(Math.random()*30000)+10000;db[senderId].wallet+=bonus;saveDB();return chatObj.sendMessage(`🎉 *CAUGHT!* But you already own *${wild.name}*!\n💰 Released for *+$${bonus.toLocaleString()}*!`,{mentions:[senderId]}).catch(()=>{});}
                else{db[senderId].pokemon=db[senderId].pokemon||[];db[senderId].pokemon.push({name:wild.name,tier:wild.rarity,level:1,xp:0,maxXp:100,hp:wild.hp,maxHp:wild.hp,atk:wild.atk,emoji:wild.emoji,dexId:wild.dexId,gender:Math.random()>0.5?'♂':'♀'});saveDB();return chatObj.sendMessage(`🎉 *GOTCHA!* *${wild.emoji} ${wild.name}* [${wild.rarity}] caught!\n❤️ HP: ${wild.hp} | ⚔️ ATK: ${wild.atk}\n\n🎊 Congrats @${senderId.split('@')[0]}! Check \`.inv\`!`,{mentions:[senderId]}).catch(()=>{});}
            } else {
                if(Math.random()<0.2){delete wildPokemonState[cid];return chatObj.sendMessage(`💨 *${wild.emoji} ${wild.name}* shook off the ball and *FLED!* Even weakened... unlucky! 😤`,{mentions:[senderId]}).catch(()=>{});}
                saveDB(); return chatObj.sendMessage(`❌ *${wild.emoji} ${wild.name}* broke free from the ${ballInfo.emoji}!\n🔴 ${ballKey} left: ${inv[ballKey]}\n💡 Try again or use a stronger ball!`,{mentions:[senderId]}).catch(()=>{});
            }
        }

    } catch (err) {
        console.error('Bot error:', err.message);
    }
});

// ── NEW FEATURES PATCH ────────────────────────────────────────────────────────

// ── LINK WARNING TRACKER ──────────────────────────────────────────────────────
let linkWarnings = {};  // { userId_chatId: count }

// ── FUNNY ROAST LINES (for .roast and .beg) ───────────────────────────────────
const FUNNY_ROASTS = [
    "You're the human version of a participation trophy. 🏆",
    "I've seen better moves at a chess club for grandmas. ♟️",
    "Your WiFi password is probably 'password123', isn't it? 🔑",
    "You bring joy to everyone when you leave the room. 👋",
    "Your cooking is so bad even the smoke alarm cheers you on. 🔔",
    "You must have been born on a highway — that's where most accidents happen. 🚗",
    "I'd roast you harder but my mom said I'm not allowed to burn trash. 🗑️",
    "You're like a cloud. When you disappear, it's a beautiful day. ☀️",
    "I've met furniture with more personality. 🪑",
    "You're the reason the gene pool needs a lifeguard. 🏊",
    "Your brain is so small that if it was a country, it'd be the capital of nothing. 🧠",
    "You have the energy of a dead phone at 0% with no charger nearby. 📱",
    "Even your reflection rolls its eyes at you. 🪞",
    "You remind me of a software update — nobody wants you, but here you are. 💻",
    "If stupidity was a sport, you'd be the world champion. 🥇",
];

const BEG_ROASTS = [
    "Here's some charity money, you absolute broke goblin. 😂",
    "Congrats, you begged better than a stray dog. Here's your reward! 🐕",
    "Even the piggy bank felt sorry for you. Here! 🐷",
    "Stop begging and get a job... but okay fine, here. 💸",
    "You're so broke even your wallet cried. We felt bad. Here's cash! 😭",
    "The begging hotline connected you straight to us. Here's your survival money! 📞",
    "Poverty speedrun any% complete. Here's your consolation prize! 🏃",
    "You smelled like broke from here. Take this and buy some dignity. 🤑",
    "Even the economy felt bad for you. Here! 💰",
    "You've unlocked the 'Certified Beggar' achievement. +cash! 🏅",
];

// ── PATCH: Add new commands to the SECOND message_create listener ─────────────
// We inject into the existing message handler by extending it.
// Since both listeners run, we add a THIRD listener for new commands only.

client.on('message_create', async msg => {
    try {
        const body = msg.body ? msg.body.trim() : '';
        const senderId = msg.author || msg.from;
        if (!body) return;

        const chatObj = await msg.getChat();
        const isGroupChat = chatObj.isGroup;

        let isMod = false;
        if (msg.fromMe) { isMod = true; }
        else {
            try {
                if (isGroupChat && chatObj.participants) {
                    isMod = chatObj.participants.some(p =>
                        p.id._serialized === senderId && (p.isAdmin || p.isSuperAdmin));
                } else if (!isGroupChat) { isMod = true; }
            } catch (_) {}
        }

        // Also treat MOD_NUMBERS as mods regardless of group admin status
        if (MOD_NUMBERS.includes(senderId)) isMod = true;

        // ── SECURITY: Auto link detection in groups ───────────────────────────
        if (isGroupChat && !isMod && !body.startsWith('.')) {
            const urlRegex = /(https?:\/\/|www\.|t\.me\/|wa\.me\/|bit\.ly\/|tinyurl\.com\/)[^\s]*/i;
            if (urlRegex.test(body)) {
                const cid = chatObj.id._serialized;
                const warnKey = `${senderId}_${cid}`;
                linkWarnings[warnKey] = (linkWarnings[warnKey] || 0) + 1;
                const count = linkWarnings[warnKey];
                const mod1 = MOD_NUMBERS[0];
                const mod2 = MOD_NUMBERS[1];

                if (count >= 3) {
                    // Kick the user
                    try { await chatObj.removeParticipants([senderId]); } catch (_) {}
                    delete linkWarnings[warnKey];
                    return chatObj.sendMessage(
                        `🚫 *USER REMOVED* 🚫\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
                        `👤 @${senderId.split('@')[0]} has been *removed from the group*.\n` +
                        `📋 *Reason:* Sending links (3 violations)\n\n` +
                        `👮 Notifying: @${mod1.split('@')[0]} @${mod2.split('@')[0]}`,
                        { mentions: [senderId, mod1, mod2] }
                    ).catch(() => {});
                } else {
                    const warnsLeft = 3 - count;
                    return chatObj.sendMessage(
                        `⚠️ *LINK WARNING ${count}/3* ⚠️\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
                        `@${senderId.split('@')[0]} — *sending links is NOT allowed!*\n` +
                        `❗ You have *${warnsLeft} warning${warnsLeft !== 1 ? 's' : ''} left* before removal.\n\n` +
                        `👮 Mods notified: @${mod1.split('@')[0]} @${mod2.split('@')[0]}`,
                        { mentions: [senderId, mod1, mod2] }
                    ).catch(() => {});
                }
            }
        }

        if (!body.startsWith('.')) return;
        if (!db._config?.botActive && body !== '.bot on' && body !== '.bot off') return;

        const args = body.split(' ').filter(a => a !== '');
        const command = args[0].toLowerCase();

        // ── .help (same as .mods) ─────────────────────────────────────────────
        if (command === '.help') {
            const mod1 = MOD_NUMBERS[0];
            const mod2 = MOD_NUMBERS[1];
            const modMsg = `📢 *MOD ALERT — HELP NEEDED!* 📢\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
                           `⚠️ @${senderId.split('@')[0]} needs assistance!\n\n` +
                           `👮 Tagging Moderators:\n• @${mod1.split('@')[0]}\n• @${mod2.split('@')[0]}\n\n` +
                           `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n_Please attend to the group as soon as possible!_`;
            return chatObj.sendMessage(modMsg, { mentions: [senderId, mod1, mod2] }).catch(() => {});
        }

        // ── .menu ─────────────────────────────────────────────────────────────
        if (command === '.menu') {
            return msg.reply(
                `🎮 *BOT COMMAND MENU* 🎮\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
                `💰 *ECONOMY*\n` +
                `• \`.bal\` — Check your balance\n` +
                `• \`.daily\` — Claim daily reward\n` +
                `• \`.deposit\` / \`.withdraw\` — Bank transfers\n` +
                `• \`.transfer [@user] [amt]\` — Send money\n` +
                `• \`.beg\` — Beg for coins (with roast!)\n` +
                `• \`.rich\` — Top 10 richest players\n\n` +
                `🎲 *GAMBLING*\n` +
                `• \`.gamble\` — See all gambling games\n` +
                `• \`.casino\` / \`.slots\` / \`.roulette\` / \`.db\` / \`.cf\`\n` +
                `• \`.rob [@user]\` — Rob someone!\n\n` +
                `🐾 *POKÉMON*\n` +
                `• \`.catch\` — Battle wild Pokémon\n` +
                `• \`.throwball [type]\` — Catch weakened Pokémon\n` +
                `• \`.battle [@user]\` — Challenge someone to PvP\n` +
                `• \`.health\` — Your active Pokémon status\n` +
                `• \`.feed [pokemon] [food]\` — Feed your Pokémon\n` +
                `• \`.use [pokemon]\` — Switch active Pokémon\n` +
                `• \`.inv\` — View inventory & team\n\n` +
                `🛒 *SHOP*\n` +
                `• \`.pstore\` — All Pokémon items in one store\n` +
                `• \`.buy [item]\` — Purchase any item\n\n` +
                `🎣 *ACTIVITIES*\n` +
                `• \`.fish\` — Go fishing\n` +
                `• \`.dig\` — Dig for treasure\n` +
                `• \`.sell [fish]\` — Sell your catch\n\n` +
                `😂 *FUN*\n` +
                `• \`.roast [@user]\` — Roast someone\n` +
                `• \`.beg\` — Beg for money\n\n` +
                `⚙️ *UTILITY*\n` +
                `• \`.cds\` — Show all your cooldowns\n` +
                `• \`.help\` / \`.mods\` — Call a moderator\n` +
                `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
            );
        }

        // ── .roast ────────────────────────────────────────────────────────────
        if (command === '.roast') {
            let targetId = msg.mentionedIds?.[0] || (msg.hasQuotedMsg ? (await msg.getQuotedMessage()).author : null);
            const roastLine = FUNNY_ROASTS[Math.floor(Math.random() * FUNNY_ROASTS.length)];

            if (!targetId) {
                // Roast the sender themselves
                return chatObj.sendMessage(
                    `🔥 *SELF-ROAST ACTIVATED* 🔥\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
                    `🎯 @${senderId.split('@')[0]}, you asked for it...\n\n` +
                    `💀 ${roastLine}\n\n` +
                    `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n_Next time tag someone else! 😂_`,
                    { mentions: [senderId] }
                ).catch(() => {});
            } else {
                // Roast the tagged user
                return chatObj.sendMessage(
                    `🔥 *ROAST INCOMING!* 🔥\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
                    `🎯 @${targetId.split('@')[0]}, @${senderId.split('@')[0]} sent this for you...\n\n` +
                    `💀 ${roastLine}\n\n` +
                    `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n_Get destroyed! 😂🔥_`,
                    { mentions: [senderId, targetId] }
                ).catch(() => {});
            }
        }

        // ── .beg ──────────────────────────────────────────────────────────────
        if (command === '.beg') {
            initUser(senderId);
            const now = Date.now();
            // 60s cooldown on beg
            if (!db[senderId].lastBeg) db[senderId].lastBeg = 0;
            if ((now - db[senderId].lastBeg) / 1000 < 60) {
                const left = Math.ceil(60 - (now - db[senderId].lastBeg) / 1000);
                return msg.reply(`😂 You just begged! Have some dignity. Wait *${left}s*.`);
            }
            const earned = Math.floor(Math.random() * 100) + 1;
            db[senderId].wallet += earned;
            db[senderId].lastBeg = now;
            saveDB();
            const roastLine = BEG_ROASTS[Math.floor(Math.random() * BEG_ROASTS.length)];
            return chatObj.sendMessage(
                `🙏 *BEG RESULT* 🙏\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
                `💬 ${roastLine}\n\n` +
                `💰 @${senderId.split('@')[0]} received *+$${earned}*!\n` +
                `👛 Wallet: $${db[senderId].wallet.toLocaleString()}\n` +
                `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
                { mentions: [senderId] }
            ).catch(() => {});
        }

        // ── .cds (show all cooldowns) ─────────────────────────────────────────
        if (command === '.cds') {
            initUser(senderId);
            const now = Date.now();
            const u = db[senderId];
            const cdLeft = (last, cd) => {
                const diff = cd - (now - last) / 1000;
                if (diff <= 0) return '✅ Ready';
                const m = Math.floor(diff / 60);
                const s = Math.ceil(diff % 60);
                return m > 0 ? `⏳ ${m}m ${s}s` : `⏳ ${s}s`;
            };
            return msg.reply(
                `⏱️ *COOLDOWN STATUS* ⏱️\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
                `⛏️ *Dig* (60s): ${cdLeft(u.lastDig, CD_DIG)}\n` +
                `🎣 *Fish* (45s): ${cdLeft(u.lastFish, CD_FISH)}\n` +
                `🎰 *Casino* (3min): ${cdLeft(u.lastCasino, CD_CASINO)}\n` +
                `🎰 *Slots* (45s): ${cdLeft(u.lastSlots, CD_SLOTS)}\n` +
                `🎡 *Roulette* (40s): ${cdLeft(u.lastRoulette, CD_ROULETTE)}\n` +
                `⚖️ *Double/Bet* (30s): ${cdLeft(u.lastDb, CD_DB)} [${u.dailyDbCount || 0}/15 today]\n` +
                `🪙 *Coinflip* (30s): ${cdLeft(u.lastCoinflip, CD_COINFLIP)}\n` +
                `🦹 *Rob* (5min): ${cdLeft(u.lastRob, CD_ROB)}\n` +
                `🎁 *Daily*: ${u.lastDaily && (now - u.lastDaily) < 86400000 ? `⏳ ${Math.floor((86400000 - (now - u.lastDaily)) / 3600000)}h ${Math.floor(((86400000 - (now - u.lastDaily)) % 3600000) / 60000)}m` : '✅ Ready'}\n` +
                `🙏 *Beg* (60s): ${cdLeft(u.lastBeg || 0, 60)}\n` +
                `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
            );
        }

        // ── .pstore (combined Pokémon store) ──────────────────────────────────
        if (command === '.pstore') {
            initUser(senderId);
            let menu = `🏪 *POKÉMON STORE* 🏪\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n`;
            menu += `🔴 *POKÉBALLS*\n`;
            for (let key in POKEBALL_SHOP) {
                const b = POKEBALL_SHOP[key];
                menu += `${b.emoji} *${b.name}* — $${b.price.toLocaleString()}\n   📝 ${b.desc}\n   _(buy: \`.buy ${key}\`)_\n\n`;
            }
            menu += `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n🍗 *POKÉMON FOOD*\n`;
            for (let key in FOOD_SHOP) {
                const f = FOOD_SHOP[key];
                menu += `${f.emoji} *${f.name}* — $${f.price.toLocaleString()}\n   📝 ${f.desc}\n   _(buy: \`.buy ${key}\`)_\n\n`;
            }
            menu += `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n💡 Purchase anything with \`.buy [item]\``;
            return msg.reply(menu);
        }

        // ── .rich (top 10 richest in group) ───────────────────────────────────
        if (command === '.rich') {
            if (!isGroupChat) return msg.reply('❌ This command only works in groups!');
            const participants = chatObj.participants || [];
            const richList = [];
            for (const p of participants) {
                const uid = p.id._serialized;
                if (db[uid]) {
                    const u = db[uid];
                    const total = (u.wallet || 0) + (u.bank || 0);
                    richList.push({ uid, total, wallet: u.wallet || 0, bank: u.bank || 0 });
                }
            }
            richList.sort((a, b) => b.total - a.total);
            const top = richList.slice(0, 10);
            if (top.length === 0) return msg.reply('❌ No registered players in this group yet!');
            const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
            let txt = `💎 *TOP 10 RICHEST PLAYERS* 💎\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n`;
            top.forEach((r, i) => {
                txt += `${medals[i]} @${r.uid.split('@')[0]}\n`;
                txt += `   💰 Wallet: $${r.wallet.toLocaleString()} | 🏦 Bank: $${r.bank.toLocaleString()}\n`;
                txt += `   💎 Net Worth: *$${r.total.toLocaleString()}*\n\n`;
            });
            txt += `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;
            const mentions = top.map(r => r.uid);
            return chatObj.sendMessage(txt, { mentions }).catch(() => {});
        }

        // ── .kick ─────────────────────────────────────────────────────────────
        if (command === '.kick') {
            if (!isGroupChat) return msg.reply('❌ This command only works in groups!');
            if (!isMod) return msg.reply('❌ Only group admins can kick members!');
            let targetId = msg.mentionedIds?.[0] || (msg.hasQuotedMsg ? (await msg.getQuotedMessage()).author : null);
            if (!targetId) return msg.reply('❌ Tag someone or reply to their message to kick them.');
            if (targetId === senderId) return msg.reply('❌ You cannot kick yourself!');
            if (MOD_NUMBERS.includes(targetId)) return msg.reply('❌ Cannot kick a moderator!');
            try {
                await chatObj.removeParticipants([targetId]);
                return chatObj.sendMessage(
                    `🚪 *MEMBER REMOVED* 🚪\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
                    `👤 @${targetId.split('@')[0]} has been *kicked from the group*.\n` +
                    `⚖️ Action by: @${senderId.split('@')[0]}\n` +
                    `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
                    { mentions: [targetId, senderId] }
                ).catch(() => {});
            } catch (e) {
                return msg.reply(`❌ Could not kick @${targetId.split('@')[0]}. Make sure the bot is an admin!`);
            }
        }

    } catch (err) {
        console.error('New commands error:', err.message);
    }
});

client.initialize();