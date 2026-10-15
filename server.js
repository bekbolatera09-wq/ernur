"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const http = require("node:http");
const { Server } = require("socket.io");
const { QUESTIONS, drawQuestion, initializeQuestionCycle } = require("./question-bank");
const {
  BONUS_CONFIG, canRollDice, canUseExtraMove, grantBonus,
  pickWeightedBonus, resolveDuplicateDouble, shouldOfferExtraMove
} = require("./game-rules");

const PORT = Number(process.env.PORT) || 3000;
const ROOM_TTL = 2 * 60 * 60 * 1000;
const MAX_PLAYERS = 12;
const COLORS = [
  { id: "black", name: "Қара", value: "#202a34" },
  { id: "yellow", name: "Сары", value: "#ffd447" },
  { id: "red", name: "Қызыл", value: "#ed4b52" },
  { id: "blue", name: "Көк", value: "#3478ef" },
  { id: "green", name: "Жасыл", value: "#39b968" },
  { id: "orange", name: "Сарғыш", value: "#f28b35" },
  { id: "purple", name: "Күлгін", value: "#9a62e8" },
  { id: "pink", name: "Қызғылт", value: "#ed75b4" },
  { id: "white", name: "Ақ", value: "#f6f4ed" },
  { id: "cyan", name: "Көгілдір", value: "#24bdc8" },
  { id: "brown", name: "Қоңыр", value: "#9a6245" },
  { id: "gray", name: "Сұр", value: "#aab4c0" }
];
const COLOR_BY_ID = new Map(COLORS.map((color) => [color.id, color]));
const CITY_SPACES = new Map([[6, "Түркістан"], [12, "Отырар"], [19, "Тараз"], [37, "Сауран"], [46, "Сарайшық"]]);
const BONUS_SPACES = new Set([4, 11, 20, 29, 40]);
const CHEST_SPACES = new Set([7, 13, 22, 32, 47]);
const STAR_SPACES = new Set([3, 9, 15, 24, 34, 43]);
const ACHIEVEMENTS = {
  scholar: { icon: "🥇", title: "Тарих білгірі", description: "10 сұраққа дұрыс жауап берді." },
  quick: { icon: "🔥", title: "Жылдам ой", description: "Сұраққа алғашқы 10 секундта дұрыс жауап берді." },
  ruler: { icon: "👑", title: "Қала билеушісі", description: "5 қаланы иеленді." },
  streak: { icon: "📚", title: "ҰБТ шебері", description: "Қатарынан 5 сұраққа дұрыс жауап берді." }
};
const CHEST_REWARDS = [
  { id: "points", icon: "💎", title: "+100 ұпай", description: "Қазынадан 100 ұпай алдыңыз." },
  { id: "double", icon: "⚡", title: "Қос жүріс", description: "Қосымша жүрісті қаласаңыз, келесі кезекте бір рет қолдана аласыз." },
  { id: "shield", icon: "🛡️", title: "Қорғаныс", description: "Теріс әсерге қарсы бір қорғаныс жинағы берілді." },
  { id: "time", icon: "⏳", title: "+30 секунд", description: "Келесі сұрақта 90 секунд беріледі." },
  { id: "fifty", icon: "🎯", title: "50/50 мүмкіндігі", description: "Келесі сұрақта екі қате жауапты алып тастай аласыз." },
  { id: "hard", icon: "📜", title: "Күрделі тарихи сұрақ", description: "Дұрыс жауабыңызға қосымша +50 ұпай беріледі." },
  { id: "rare-points", icon: "✨", title: "Сирек бонус · +150 ұпай", description: "Сирек қазынадан бірден 150 ұпай алдыңыз." },
  { id: "rare-move", icon: "🌠", title: "Сирек бонус · қос жүріс", description: "Қосымша жүрісті қаласаңыз, келесі кезекте бір рет қолдана аласыз." }
];

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const rooms = new Map();
app.use(express.static(path.join(__dirname, "public")));

function safeName(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ");
}

function fail(message) {
  const error = new Error(message);
  error.code = "ACTION_REJECTED";
  return error;
}

function randomItem(values) {
  return values[crypto.randomInt(values.length)];
}

function randomCode() {
  let code;
  do {
    code = String(crypto.randomInt(1000, 1_000_000));
  } while (rooms.has(code));
  return code;
}

function makeSpaces() {
  return Array.from({ length: 48 }, (_, index) => {
    const number = index + 2;
    const city = CITY_SPACES.get(number) || null;
    const type = city ? "city" : BONUS_SPACES.has(number) ? "bonus" :
      CHEST_SPACES.has(number) ? "chest" : STAR_SPACES.has(number) ? "star" : "question";
    return { number, type, city, ownerId: null };
  });
}

function touch(room) {
  room.lastActivity = Date.now();
}

function log(room, message) {
  room.state.log.unshift(message);
  room.state.log = room.state.log.slice(0, 25);
}

function clearTimer(room, name) {
  if (!room.timers[name]) return;
  clearTimeout(room.timers[name]);
  clearInterval(room.timers[name]);
  delete room.timers[name];
}

function clearGameTimers(room) {
  for (const name of Object.keys(room.timers)) clearTimer(room, name);
}

function publicQuestion(question) {
  if (!question) return null;
  return {
    id: question.id,
    playerId: question.playerId,
    kind: question.kind,
    category: question.data.topic,
    city: question.space?.city || null,
    text: question.data.question,
    answers: question.data.options.map((text, index) => ({ index, text })).filter((answer) => question.visibleAnswers.includes(answer.index)),
    deadline: question.deadline,
    duration: question.duration
  };
}

function serializeRoom(room, playerId) {
  const state = room.state;
  const players = room.players.map((player) => {
    const { socketId, ...safePlayer } = player;
    return { ...safePlayer, colorName: COLOR_BY_ID.get(player.color)?.name || "Қара" };
  });
  return {
    code: room.code,
    hostId: room.hostId,
    maxPlayers: room.maxPlayers,
    players,
    meId: playerId || null,
    currentTurn: room.currentTurn,
    currentPlayerId: room.players[room.currentTurn]?.id || null,
    turnRolls: state.turnRolls,
    extraMoveOffer: state.extraMoveOffer,
    extraMovePending: state.extraMovePending,
    phase: state.phase,
    spaces: state.spaces,
    diceValue: state.diceValue,
    question: publicQuestion(state.question),
    answerResult: state.answerResult,
    reward: state.reward,
    rewardSource: state.rewardSource,
    rewardCount: state.rewards.length,
    usedQuestionIds: [...state.usedQuestionIds],
    questionCycle: state.questionCycle,
    questionsRemaining: state.questionQueue.length,
    openedChests: state.openedChests,
    log: state.log,
    winnerId: state.winnerId,
    tied: state.tied,
    deadline: state.question?.deadline || null
  };
}

function broadcast(room, event = "stateUpdate") {
  const roomState = serializeRoom(room);
  for (const player of room.players) {
    if (player.socketId) io.to(player.socketId).emit(event, { ...roomState, meId: player.id });
  }
}

function playerForSocket(socket, room) {
  return room?.players.find((player) => player.socketId === socket.id) || null;
}

function roomForSocket(socket) {
  return socket.data.roomCode ? rooms.get(socket.data.roomCode) : null;
}

function requirePlayer(socket, { phase, turn = false } = {}) {
  const room = roomForSocket(socket);
  const player = room && playerForSocket(socket, room);
  if (!room || !player || !player.connected) throw fail("Ойын бөлмесіне қайта қосылыңыз.");
  if (phase && room.state.phase !== phase) throw fail("Бұл әрекетті қазір орындау мүмкін емес.");
  if (turn && room.players[room.currentTurn]?.id !== player.id) throw fail("Қазір сіздің кезегіңіз емес.");
  touch(room);
  return { room, player };
}

function request(socket, event, handler) {
  socket.on(event, (payload = {}, acknowledgement) => {
    try {
      const result = handler(socket, payload || {});
      if (typeof acknowledgement === "function") acknowledgement({ ok: true, ...(result || {}) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Әрекетті орындау мүмкін болмады.";
      socket.emit("actionError", { event, message });
      if (typeof acknowledgement === "function") acknowledgement({ ok: false, error: message });
    }
  });
}

function nextAvailableColor(room, exceptId = null) {
  const occupied = new Set(room.players.filter((player) => player.id !== exceptId).map((player) => player.color));
  return COLORS.find((color) => !occupied.has(color.id))?.id || null;
}

function validateName(room, name, exceptId = null) {
  const clean = safeName(name);
  if (!clean || clean.length > 16) throw fail("Есімді міндетті түрде енгізіңіз (ең көбі 16 таңба).");
  const duplicate = room.players.some((player) => player.id !== exceptId && player.name.toLocaleLowerCase("kk") === clean.toLocaleLowerCase("kk"));
  if (duplicate) throw fail("Бұл есім бөлмеде қолданылып қойған.");
  return clean;
}

function makePlayer(socket, name, color) {
  return {
    id: crypto.randomUUID(),
    socketId: socket.id,
    name,
    color,
    connected: true,
    position: 0,
    score: 0,
    stars: 0,
    correct: 0,
    streak: 0,
    achievements: [],
    shields: 0,
    extraTime: 0,
    fiftyFifty: 0,
    extraMoves: 0,
    finished: false,
    starPrize: false
  };
}

function attachPlayer(socket, room, player) {
  player.socketId = socket.id;
  player.connected = true;
  socket.data.roomCode = room.code;
  socket.data.playerId = player.id;
  socket.join(room.code);
}

function cityCount(room, player) {
  return room.state.spaces.filter((space) => space.ownerId === player.id).length;
}

function allPlayersFinished(room) {
  const participating = room.players.filter((player) => player.connected);
  return participating.length > 0 && participating.every((player) => player.finished);
}

function emitState(room) {
  broadcast(room);
}

function startQuestion(room, player, kind, space = null) {
  const data = drawQuestion(room.state);
  const duration = 60 + player.extraTime;
  player.extraTime = 0;
  const question = {
    id: crypto.randomUUID(),
    playerId: player.id,
    kind,
    space,
    data,
    duration,
    startedAt: Date.now(),
    deadline: Date.now() + duration * 1000,
    visibleAnswers: [0, 1, 2, 3]
  };
  room.state.question = question;
  room.state.answerResult = null;
  room.state.phase = "question";
  room.state.reward = null;
  clearTimer(room, "question");
  room.timers.question = setInterval(() => {
    if (!room.state.question || room.state.phase !== "question") {
      clearTimer(room, "question");
      return;
    }
    if (Date.now() >= room.state.question.deadline) {
      resolveAnswer(room, null, true);
      return;
    }
    emitState(room);
  }, 1000);
  emitState(room);
}

function awardAchievement(room, player, id, rewards) {
  if (player.achievements.includes(id)) return;
  player.achievements.push(id);
  const achievement = ACHIEVEMENTS[id];
  rewards.push({
    icon: achievement.icon,
    title: `Жетістік: ${achievement.title}`,
    description: `${player.name} жаңа жетістік ашты. ${achievement.description}`
  });
  log(room, `${player.name} «${achievement.title}» жетістігін алды.`);
}

function checkAchievements(room, player, rewards, fast) {
  if (fast) awardAchievement(room, player, "quick", rewards);
  if (player.correct >= 10) awardAchievement(room, player, "scholar", rewards);
  if (player.streak >= 5) awardAchievement(room, player, "streak", rewards);
  if (cityCount(room, player) >= 5) awardAchievement(room, player, "ruler", rewards);
}

function resolveAnswer(room, answerIndex, timedOut) {
  const question = room.state.question;
  if (!question || room.state.phase !== "question") return;
  clearTimer(room, "question");
  const player = room.players.find((candidate) => candidate.id === question.playerId);
  if (!player) return;
  const correct = !timedOut && answerIndex === question.data.correctIndex;
  const rewards = [];
  room.state.answerResult = {
    questionId: question.id,
    correct,
    timedOut,
    correctIndex: question.data.correctIndex,
    submittedIndex: timedOut ? null : answerIndex,
    message: timedOut
      ? `Уақыт аяқталды. Дұрыс жауап: ${question.data.options[question.data.correctIndex]}.`
      : correct ? "Дұрыс жауап! +20 ұпай" : `Қате жауап. Дұрысы: ${question.data.options[question.data.correctIndex]}.`
  };
  if (correct) {
    player.score += 20 + (question.kind === "hard" ? 50 : 0);
    player.correct += 1;
    player.streak += 1;
    checkAchievements(room, player, rewards, Date.now() - question.startedAt <= 10_000);
    if (question.kind === "city") {
      question.space.ownerId = player.id;
      log(room, `${player.name} ${question.space.city} қаласын иеленді.`);
      checkAchievements(room, player, rewards, false);
    } else if (question.kind === "attack") {
      question.space.ownerId = player.id;
      player.score += 50;
      log(room, `${player.name} ${question.space.city} қаласын тартып алып, +50 ұпай алды.`);
      checkAchievements(room, player, rewards, false);
    }
  } else {
    player.streak = 0;
    if (question.kind === "attack") {
      const owner = room.players.find((candidate) => candidate.id === question.space.ownerId);
      if (owner) {
        owner.score += 20;
        log(room, `${owner.name} ${question.space.city} қаласын қорғап, +20 ұпай алды.`);
      }
    }
  }
  room.state.rewards = rewards;
  room.state.phase = "answerResult";
  emitState(room);
  schedule(room, "answerResult", () => {
    room.state.question = null;
    room.state.answerResult = null;
    if (player.connected) startRewards(room, rewards, "ЖАУАП НӘТИЖЕСІ");
    else advanceTurn(room);
  }, timedOut ? 1700 : 1000);
}

function schedule(room, name, callback, milliseconds) {
  clearTimer(room, name);
  room.timers[name] = setTimeout(() => {
    delete room.timers[name];
    callback();
  }, milliseconds);
}

function startRewards(room, rewards, source = "СЫЙЛЫҚ") {
  room.state.rewards = [...rewards];
  room.state.rewardSource = source;
  room.state.reward = room.state.rewards.shift() || null;
  if (!room.state.reward) {
    advanceTurn(room);
    return;
  }
  room.state.phase = "reward";
  emitState(room);
}

function chestReward(room, player) {
  let selected = randomItem(CHEST_REWARDS);
  if ((selected.id === "double" || selected.id === "rare-move") && player.extraMoves > 0) {
    player.extraMoves = 0;
    selected = pickWeightedBonus(["double"]);
  }
  const gift = { ...selected, description: selected.description };
  if (gift.id === "points") player.score += 100;
  else if (gift.id === "rare-points") player.score += 150;
  else if (gift.id === "double" || gift.id === "rare-move") player.extraMoves = 1;
  else if (gift.id === "shield") player.shields += 1;
  else if (gift.id === "time") player.extraTime += 30;
  else if (gift.id === "fifty") player.fiftyFifty += 1;
  else if (gift.id === "hard") {
    log(room, `${player.name} қазынадан күрделі сұрақ тапты.`);
    startQuestion(room, player, "hard");
    return;
  }
  log(room, `${player.name} сандық ашып, сыйлық алды: ${gift.title}.`);
  startRewards(room, [gift], "ҚАЗЫНА САНДЫҒЫ");
}

function landOnSpace(room, player) {
  const space = room.state.spaces[player.position - 1];
  if (!space) return advanceTurn(room);
  log(room, `${player.name} ${space.number}-ұяшыққа түсті${space.city ? ` · ${space.city}` : ""}.`);
  if (space.type === "question") {
    startQuestion(room, player, "general");
    return;
  }
  if (space.type === "city") {
    const owner = room.players.find((candidate) => candidate.id === space.ownerId);
    if (!owner) {
      startQuestion(room, player, "city", space);
      return;
    }
    if (owner.id === player.id) {
      player.score += 10;
      log(room, `${player.name} өз қаласы ${space.city} үшін +10 ұпай алды.`);
      startRewards(room, [{ icon: "🏰", title: "Өз қалаңыз!", description: `${space.city} өз иелігіңізде. +10 ұпай алдыңыз.` }]);
      return;
    }
    startQuestion(room, player, "attack", space);
    return;
  }
  if (space.type === "star") {
    player.stars += 1;
    player.score += 30;
    const rewards = [{ icon: "⭐", title: "Жұлдызша!", description: `${player.name} +30 ұпай алды. Жұлдыздары: ${player.stars}.` }];
    log(room, `${player.name} жұлдызша алып, 30 ұпай жинады.`);
    if (player.stars >= 3 && !player.starPrize) {
      player.starPrize = true;
      player.score += 100;
      player.extraMoves = 1;
      rewards.push({ icon: "🌟", title: "Үш жұлдыз сыйлығы!", description: `${player.name} +100 ұпай және бір қосымша жүріс алды.` });
      log(room, `${player.name} үш жұлдыз жинап, арнайы сыйлық алды.`);
    }
    startRewards(room, rewards);
    return;
  }
  if (space.type === "bonus") {
    let bonus = pickWeightedBonus();
    bonus = resolveDuplicateDouble(player, bonus);
    grantBonus(player, bonus);
    log(room, `${player.name} бонус алды: ${bonus.title}.`);
    startRewards(room, [{ icon: bonus.icon, title: bonus.title, description: bonus.description }], "БОНУС ҰЯШЫҒЫ");
    return;
  }
  if (space.type === "chest") {
    if (room.state.openedChests.includes(space.number)) {
      startRewards(room, [{ icon: "🧰", title: "Сандық бос", description: "Бұл сандықты осы ойында басқа ойыншы ашып қойған." }], "ҚАЗЫНА САНДЫҒЫ");
      return;
    }
    room.state.openedChests.push(space.number);
    chestReward(room, player);
    return;
  }
  advanceTurn(room);
}

function advanceTurn(room, skipExtraMoveOffer = false) {
  clearTimer(room, "question");
  clearTimer(room, "answerResult");
  room.state.question = null;
  room.state.answerResult = null;
  room.state.reward = null;
  room.state.rewards = [];
  const player = room.players[room.currentTurn];
  if (!skipExtraMoveOffer && shouldOfferExtraMove(room.state, player)) {
    room.state.extraMoveOffer = true;
    room.state.extraMovePending = false;
    room.state.phase = "ready";
    emitState(room);
    return;
  }
  room.state.turnRolls = 0;
  room.state.extraMoveOffer = false;
  room.state.extraMovePending = false;
  if (allPlayersFinished(room)) {
    finishGame(room);
    return;
  }
  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const index = (room.currentTurn + offset) % room.players.length;
    const next = room.players[index];
    if (next.connected && !next.finished) {
      room.currentTurn = index;
      room.state.phase = "ready";
      emitState(room);
      return;
    }
  }
  room.state.phase = "waiting";
  emitState(room);
}

function finishGame(room) {
  clearGameTimers(room);
  room.state.question = null;
  room.state.answerResult = null;
  room.state.reward = null;
  room.state.phase = "ended";
  const ranking = [...room.players].sort((a, b) =>
    b.score - a.score || cityCount(room, b) - cityCount(room, a) || b.correct - a.correct
  );
  room.state.winnerId = ranking[0]?.id || null;
  room.state.tied = ranking.length > 1 &&
    ranking[0].score === ranking[1].score &&
    cityCount(room, ranking[0]) === cityCount(room, ranking[1]) &&
    ranking[0].correct === ranking[1].correct;
  log(room, room.state.tied ? "Ойын тең нәтижемен аяқталды." : `Ойын аяқталды. Жеңімпаз: ${ranking[0].name}.`);
  emitState(room);
}

function beginMove(room, player, roll) {
  room.state.phase = "moving";
  const destination = Math.min(48, player.position + roll);
  const step = () => {
    if (!player.connected || room.state.phase !== "moving") return;
    player.position += 1;
    if (player.position >= 48) {
      player.position = 48;
      player.finished = true;
    }
    io.to(room.code).emit("move", { playerId: player.id, position: player.position, diceValue: roll });
    emitState(room);
    if (player.position >= destination) {
      clearTimer(room, "move");
      landOnSpace(room, player);
      emitState(room);
      return;
    }
    room.timers.move = setTimeout(step, 300);
  };
  if (destination === player.position) {
    player.finished = true;
    landOnSpace(room, player);
    emitState(room);
    return;
  }
  step();
}

function detachSocket(socket, explicit = false) {
  const room = roomForSocket(socket);
  if (!room) return;
  const player = room.players.find((candidate) => candidate.socketId === socket.id);
  socket.leave(room.code);
  socket.data.roomCode = null;
  socket.data.playerId = null;
  if (!player) return;
  player.connected = false;
  player.socketId = null;
  if (explicit) {
    const wasCurrent = room.players[room.currentTurn]?.id === player.id;
    const previousTurn = room.currentTurn;
    room.players = room.players.filter((candidate) => candidate.id !== player.id);
    room.state.spaces.forEach((space) => {
      if (space.ownerId === player.id) space.ownerId = null;
    });
    if (room.hostId === player.id) room.hostId = room.players.find((candidate) => candidate.connected)?.id || null;
    if (room.players.length === 0) room.hostId = null;
    if (wasCurrent && room.state.phase !== "lobby" && room.state.phase !== "ended") {
      clearGameTimers(room);
      room.currentTurn = room.players.length ? (previousTurn - 1 + room.players.length) % room.players.length : 0;
    } else {
      const previousTurnId = room.players[previousTurn >= room.players.length ? room.players.length - 1 : previousTurn]?.id;
      const nextIndex = room.players.findIndex((candidate) => candidate.id === previousTurnId);
      room.currentTurn = nextIndex >= 0 ? nextIndex : Math.min(room.currentTurn, Math.max(0, room.players.length - 1));
    }
    log(room, `${player.name} бөлмеден шықты.`);
    io.to(room.code).emit("playerLeft", { playerId: player.id, name: player.name });
    if (wasCurrent && room.state.phase !== "lobby" && room.state.phase !== "ended") {
      room.state.turnRolls = 0;
      room.state.extraMoveOffer = false;
      room.state.extraMovePending = false;
      advanceTurn(room);
    }
    else emitState(room);
    touch(room);
    return;
  }
  log(room, `${player.name} байланысын жоғалтты. Қайта қосылуына болады.`);
  io.to(room.code).emit("playerLeft", { playerId: player.id, name: player.name, disconnected: true });
  if (room.state.phase !== "lobby" && room.state.phase !== "ended" && room.players[room.currentTurn]?.id === player.id) {
    clearGameTimers(room);
    advanceTurn(room);
  } else {
    emitState(room);
  }
  touch(room);
}

io.on("connection", (socket) => {
  socket.emit("colors", COLORS);

  socket.on("roomInfo", (data = {}, acknowledgement) => {
    try {
      if (typeof data.code !== "string" || !/^\d{4,6}$/.test(data.code)) throw fail("Код кемінде 4 саннан тұруы керек");
      const room = rooms.get(data.code);
      if (!room) throw fail("Мұндай ойын жоқ");
      if (room.state.phase !== "lobby") throw fail("Ойын басталып кеткен");
      if (room.players.length >= room.maxPlayers) throw fail("Бөлме толы");
      const availableColors = COLORS.filter((color) => !room.players.some((player) => player.color === color.id)).map((color) => color.id);
      if (typeof acknowledgement === "function") acknowledgement({
        ok: true,
        availableColors,
        playerCount: room.players.length,
        maxPlayers: room.maxPlayers
      });
    } catch (error) {
      if (typeof acknowledgement === "function") acknowledgement({
        ok: false,
        error: error instanceof Error ? error.message : "Бөлмені тексеру мүмкін болмады."
      });
    }
  });

  request(socket, "createRoom", (client, data) => {
    if (roomForSocket(client)) throw fail("Жаңа бөлме құру үшін алдымен ағымдағы бөлмеден шығыңыз.");
    const name = safeName(data.name);
    if (!name) throw fail("Есіміңізді міндетті түрде енгізіңіз.");
    if (name.length > 16) throw fail("Есім 16 таңбадан аспауы керек.");
    const maxPlayers = Number(data.maxPlayers);
    if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > MAX_PLAYERS) throw fail("Ойыншылар саны 2–12 аралығында болуы керек.");
    const colorId = COLOR_BY_ID.has(data.color) ? data.color : COLORS[0].id;
    const code = randomCode();
    const room = {
      code,
      hostId: null,
      maxPlayers,
      players: [],
      currentTurn: 0,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      state: {
        phase: "lobby", spaces: makeSpaces(), diceValue: null, question: null, answerResult: null,
        rewards: [], reward: null, rewardSource: null, openedChests: [], log: [], winnerId: null,
        tied: false, turnRolls: 0, extraMoveOffer: false, extraMovePending: false,
        questionQueue: [], usedQuestionIds: [], lastQuestionId: null, questionCycle: 0
      },
      timers: {}
    };
    const player = makePlayer(client, name, colorId);
    room.hostId = player.id;
    room.players.push(player);
    rooms.set(code, room);
    attachPlayer(client, room, player);
    emitState(room);
    return { code, playerId: player.id };
  });

  request(socket, "joinRoom", (client, data) => {
    if (roomForSocket(client)) throw fail("Басқа ойынға қосылу үшін алдымен ағымдағы бөлмеден шығыңыз.");
    if (typeof data.code !== "string" || !/^\d{4,6}$/.test(data.code)) throw fail("Код кемінде 4 саннан тұруы керек");
    const room = rooms.get(data.code);
    if (!room) throw fail("Мұндай ойын жоқ");
    if (room.state.phase !== "lobby") throw fail("Ойын басталып кеткен");
    if (room.players.length >= room.maxPlayers || room.players.length >= MAX_PLAYERS) throw fail("Бөлме толы");
    const name = validateName(room, data.name);
    const available = nextAvailableColor(room);
    if (!available) throw fail("Бөлмеде бос түс жоқ.");
    if (COLOR_BY_ID.has(data.color) && room.players.some((player) => player.color === data.color)) throw fail("Бұл түс басқа ойыншыда бар.");
    const requestedColor = COLOR_BY_ID.has(data.color) ? data.color : available;
    const player = makePlayer(client, name, requestedColor);
    room.players.push(player);
    attachPlayer(client, room, player);
    touch(room);
    io.to(room.code).emit("playerJoined", { playerId: player.id, name: player.name });
    emitState(room);
    return { code: room.code, playerId: player.id };
  });

  request(socket, "reconnect", (client, data) => {
    if (typeof data.code !== "string" || !/^\d{4,6}$/.test(data.code) || typeof data.playerId !== "string") throw fail("Қайта қосылу деректері жарамсыз.");
    const room = rooms.get(data.code);
    const player = room?.players.find((candidate) => candidate.id === data.playerId);
    if (!room || !player) throw fail("Мұндай ойын жоқ");
    if (player.connected && player.socketId === client.id) return { code: room.code, playerId: player.id };
    const previousSocketId = player.socketId;
    if (previousSocketId && previousSocketId !== client.id) {
      const previousSocket = io.sockets.sockets.get(previousSocketId);
      previousSocket?.leave(room.code);
      if (previousSocket) {
        previousSocket.data.roomCode = null;
        previousSocket.data.playerId = null;
      }
    }
    attachPlayer(client, room, player);
    touch(room);
    if (room.state.phase === "waiting" && !player.finished) {
      room.currentTurn = room.players.indexOf(player);
      room.state.phase = "ready";
    }
    log(room, `${player.name} ойынға қайта қосылды.`);
    io.to(room.code).emit("playerJoined", { playerId: player.id, name: player.name, reconnect: true });
    emitState(room);
    return { code: room.code, playerId: player.id };
  });

  request(socket, "pickColor", (client, data) => {
    const { room, player } = requirePlayer(client, { phase: "lobby" });
    if (!COLOR_BY_ID.has(data.color)) throw fail("Түс таңдауы жарамсыз.");
    if (room.players.some((candidate) => candidate.id !== player.id && candidate.color === data.color)) throw fail("Бұл түс басқа ойыншыда бар.");
    player.color = data.color;
    emitState(room);
  });

  request(socket, "startGame", (client) => {
    const { room, player } = requirePlayer(client, { phase: "lobby" });
    if (room.hostId !== player.id) throw fail("Ойынды тек бөлме иесі бастай алады.");
    const connected = room.players.filter((candidate) => candidate.connected);
    if (connected.length < 2) throw fail("Ойынды бастау үшін кемінде 2 ойыншы керек.");
    room.players = connected;
    room.currentTurn = 0;
    room.state.turnRolls = 0;
    room.state.extraMoveOffer = false;
    room.state.extraMovePending = false;
    initializeQuestionCycle(room.state);
    room.state.phase = "ready";
    room.state.log = [`${connected.length} ойыншы тарихи сапарды бастады.`];
    touch(room);
    emitState(room);
  });

  request(socket, "rollDice", (client) => {
    const { room, player } = requirePlayer(client, { phase: "ready", turn: true });
    if (player.finished) throw fail("Сіз мәреге жетіп қойдыңыз.");
    if (!canRollDice(room.state)) {
      if (room.state.turnRolls >= 2) throw fail("Бұл кезекте кубикті екі рет лақтырдыңыз.");
      if (room.state.turnRolls === 1) throw fail("Алдымен қос жүріс бонусын қолданыңыз.");
      throw fail("Қос жүріс күйі жарамсыз.");
    }
    room.state.turnRolls += 1;
    room.state.extraMoveOffer = false;
    room.state.extraMovePending = false;
    room.state.phase = "diceRolling";
    room.state.diceValue = crypto.randomInt(1, 7);
    log(room, `${player.name} кубик лақтырды.`);
    emitState(room);
    schedule(room, "dice", () => {
      if (room.state.phase !== "diceRolling" || room.players[room.currentTurn]?.id !== player.id) return;
      io.to(room.code).emit("move", { playerId: player.id, diceValue: room.state.diceValue, from: player.position });
      beginMove(room, player, room.state.diceValue);
    }, 1900);
  });

  request(socket, "useExtraMove", (client) => {
    const { room, player } = requirePlayer(client, { phase: "ready", turn: true });
    if (!canUseExtraMove(room.state, player)) {
      throw fail("Қос жүріс қазір қолжетімсіз.");
    }
    player.extraMoves -= 1;
    room.state.extraMovePending = true;
    room.state.extraMoveOffer = false;
    emitState(room);
  });

  request(socket, "endTurn", (client) => {
    const { room, player } = requirePlayer(client, { phase: "ready", turn: true });
    if (player.finished || room.state.turnRolls !== 1 || player.extraMoves < 1 || room.state.extraMovePending) {
      throw fail("Кезекті қазір аяқтау мүмкін емес.");
    }
    advanceTurn(room, true);
  });

  request(socket, "answerQuestion", (client, data) => {
    const { room, player } = requirePlayer(client, { phase: "question", turn: true });
    const question = room.state.question;
    if (!question || question.playerId !== player.id || data.questionId !== question.id) throw fail("Бұл сұрақ енді белсенді емес.");
    const answerIndex = Number(data.answerIndex);
    if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3 || !question.visibleAnswers.includes(answerIndex)) throw fail("Жауап нұсқасы жарамсыз.");
    if (Date.now() >= question.deadline) {
      resolveAnswer(room, null, true);
      return;
    }
    resolveAnswer(room, answerIndex, false);
  });

  request(socket, "useFiftyFifty", (client, data) => {
    const { room, player } = requirePlayer(client, { phase: "question", turn: true });
    const question = room.state.question;
    if (!question || question.playerId !== player.id || data.questionId !== question.id) throw fail("Бұл сұрақ енді белсенді емес.");
    if (player.fiftyFifty < 1 || question.visibleAnswers.length !== 4) throw fail("50/50 мүмкіндігі қолжетімсіз.");
    player.fiftyFifty -= 1;
    const wrong = question.visibleAnswers.filter((index) => index !== question.data.correctIndex);
    const removed = new Set();
    while (wrong.length > 2) removed.add(wrong.splice(crypto.randomInt(wrong.length), 1)[0]);
    question.visibleAnswers = question.visibleAnswers.filter((index) => !removed.has(index));
    emitState(room);
  });

  request(socket, "continueReward", (client) => {
    const { room, player } = requirePlayer(client, { phase: "reward", turn: true });
    if (!room.state.reward || room.players[room.currentTurn]?.id !== player.id) throw fail("Сыйлықты жалғастыруға рұқсат жоқ.");
    room.state.reward = room.state.rewards.shift() || null;
    if (room.state.reward) {
      emitState(room);
      return;
    }
    advanceTurn(room);
  });

  request(socket, "leaveRoom", (client) => {
    detachSocket(client, true);
    return {};
  });

  socket.on("disconnect", () => detachSocket(socket, false));
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.lastActivity <= ROOM_TTL) continue;
    clearGameTimers(room);
    for (const player of room.players) {
      if (player.socketId) io.to(player.socketId).emit("roomExpired", { message: "Бөлме 2 сағат әрекетсіз болғандықтан жабылды." });
    }
    rooms.delete(code);
  }
}, 15 * 60 * 1000).unref();

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Тарихи үстел сервері ${PORT}-портта іске қосылды.`);
  });
}

module.exports = {
  app, server, io, rooms, COLORS, makeSpaces, serializeRoom, PORT,
  QUESTIONS, BONUS_CONFIG, pickWeightedBonus
};
