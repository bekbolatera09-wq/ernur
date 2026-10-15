(() => {
  "use strict";

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
  const CITY_SPACES = { 6: "Түркістан", 12: "Отырар", 19: "Тараз", 37: "Сауран", 46: "Сарайшық" };
  const BONUS_SPACES = new Set([4, 11, 20, 29, 40]);
  const CHEST_SPACES = new Set([7, 13, 22, 32, 47]);
  const STAR_SPACES = new Set([3, 9, 15, 24, 34, 43]);
  const ACHIEVEMENTS = {
    scholar: "Тарих білгірі", quick: "Жылдам ой", ruler: "Қала билеушісі", streak: "ҰБТ шебері"
  };
  const $ = (id) => document.getElementById(id);
  const socket = io();
  const elements = {
    board: $("board-tiles"), boardWrap: $("board-wrap"), tokens: $("token-layer"),
    setup: $("setup-modal"), entryActions: $("entry-actions"), createForm: $("create-form"),
    joinForm: $("join-form"), lobby: $("lobby-panel"), createName: $("create-name"),
    createLimit: $("create-max-players"), createColor: $("create-color"),
    joinCode: $("join-code"), joinName: $("join-name"), joinColor: $("join-color"),
    createButton: $("create-room-button"), joinButton: $("join-room-button"),
    showCreate: $("show-create-button"), showJoin: $("show-join-button"),
    backEntry: $("back-entry-button"), setupError: $("setup-error"),
    roomCode: $("room-code"), copyCode: $("copy-code-button"), share: $("share-link-button"),
    lobbyList: $("lobby-list"), lobbyCount: $("lobby-count"), lobbyWaiting: $("lobby-waiting"),
    startGame: $("start-game-button"), turnLabel: $("turn-label"),
    activePlayer: $("active-player"), turnHint: $("turn-hint"), roll: $("roll-button"),
    extraMoveActions: $("extra-move-actions"), useExtraMove: $("use-extra-move-button"),
    endTurn: $("end-turn-button"),
    rollResult: $("roll-result"), players: $("players-list"), playerCount: $("player-count"),
    log: $("event-log"), diceOverlay: $("dice-overlay"), diceCube: $("dice-cube"),
    diceNumber: $("dice-result-number"), leave: $("leave-room-button"),
    questionModal: $("question-modal"), questionCategory: $("question-category"),
    questionTimer: $("question-timer"), timerBar: $("timer-bar"),
    questionTitle: $("question-title"), answers: $("answer-list"),
    questionNote: $("question-note"), questionFeedback: $("answer-feedback"),
    fifty: $("fifty-button"), questionContinue: $("question-continue"),
    rewardModal: $("reward-modal"), rewardIcon: $("reward-icon"),
    rewardEyebrow: $("reward-eyebrow"), rewardTitle: $("reward-title"),
    rewardDescription: $("reward-description"), rewardContinue: $("reward-continue"),
    info: $("info-modal"), infoIcon: $("info-icon"), infoTitle: $("info-title"),
    infoDescription: $("info-description"), infoClose: $("info-close"),
    summary: $("summary-modal"), summaryTitle: $("summary-title"),
    summaryIntro: $("summary-intro"), summaryList: $("summary-list"),
    replay: $("replay-button")
  };

  let roomState = null;
  let currentMode = "";
  let currentQuestionId = null;
  let lastPhase = "";
  let overlayTimer = null;
  let toastTimer = null;
  let roomInfoTimer = null;
  let joinAvailableColors = new Set();
  let checkedRoomCode = "";
  let knownColors = COLORS;
  let savedIdentity = null;
  const tokenElements = new Map();

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function tokenSvg(color) {
    const definition = COLORS.find((candidate) => candidate.id === color);
    const fill = definition?.value || "#ffffff";
    const stroke = color === "black" ? "#f6f4ed" : "#17231f";
    return `<svg viewBox="0 0 48 64" role="img" aria-label="Шахмат королі" style="--piece-fill:${fill};--piece-stroke:${stroke}"><path class="king-shape" d="M22 2h4v5h5v4h-5v5h-4v-5h-5V7h5z"/><circle class="king-shape" cx="24" cy="21" r="6.5"/><path class="king-shape" d="M20 27h8v6c5.1 1.1 8.1 4.6 9.1 9.1L41 54H7l3.9-11.9c1-4.5 4-8 9.1-9.1v-6Z"/><path class="king-shape" d="m10 54-2.2 6h32.4L38 54H10Z"/></svg>`;
  }

  function populateColorSelect(select) {
    const previous = select.value;
    select.replaceChildren(...knownColors.map((color) => {
      const option = document.createElement("option");
      option.value = color.id;
      option.textContent = color.name;
      return option;
    }));
    if (knownColors.some((color) => color.id === previous && !select.querySelector(`option[value="${previous}"]`)?.disabled)) {
      select.value = previous;
    }
    updateColorAvailability();
  }

  function updateColorAvailability() {
    for (const select of [elements.createColor, elements.joinColor]) {
      const selected = select.value;
      const joining = select === elements.joinColor && !roomState;
      const occupied = joining
        ? new Set(knownColors.filter((color) => !joinAvailableColors.has(color.id)).map((color) => color.id))
        : new Set((roomState?.players || []).map((player) => player.color));
      for (const option of select.options) {
        option.disabled = occupied.has(option.value) && (joining || option.value !== selected);
      }
      if ((joining && occupied.has(selected)) || select.selectedOptions[0]?.disabled) {
        const first = [...select.options].find((option) => !option.disabled);
        if (first) select.value = first.value;
      }
    }
  }

  function makeSpaces() {
    return Array.from({ length: 48 }, (_, index) => {
      const number = index + 2;
      const city = CITY_SPACES[number] || null;
      const type = city ? "city" : BONUS_SPACES.has(number) ? "bonus" :
        CHEST_SPACES.has(number) ? "chest" : STAR_SPACES.has(number) ? "star" : "question";
      return { number, type, city, ownerId: null };
    });
  }

  function tilePosition(index) {
    if (index < 12) return { left: 92.2, top: 78 - index * 5.68 };
    if (index < 24) return { left: 87.5 - (index - 12) * 6.36, top: 5.1 };
    if (index < 36) return { left: 7.6, top: 11.5 + (index - 24) * 5.74 };
    return { left: 12.2 + (index - 36) * 6.7, top: 84.4 };
  }

  function typeLabel(type) {
    return ({ city: "Тарихи қала", bonus: "Бонус", chest: "Қазына сандығы", star: "Жұлдызша", question: "Тарихи сұрақ" })[type];
  }

  function buildBoard(spaces) {
    elements.board.replaceChildren();
    spaces.forEach((space, index) => {
      const button = document.createElement("button");
      const position = tilePosition(index);
      const icon = space.type === "city" ? "🏰" : space.type === "bonus" ? "🎁" :
        space.type === "chest" ? "🧰" : space.type === "star" ? "⭐" : "📜";
      button.type = "button";
      button.className = `tile ${space.type}`;
      button.style.left = `${position.left}%`;
      button.style.top = `${position.top}%`;
      button.dataset.space = String(space.number);
      button.setAttribute("aria-label", `${space.number}-ұяшық: ${space.city || typeLabel(space.type)}`);
      button.title = `${space.number}-ұяшық · ${space.city || typeLabel(space.type)}`;
      button.innerHTML = `<span class="tile-label">${space.number}</span><span class="tile-icon" aria-hidden="true">${icon}</span><span class="tile-owner" hidden></span>`;
      button.addEventListener("click", () => showSpaceInfo(space));
      elements.board.append(button);
    });
  }

  function activePlayer() {
    return roomState?.players.find((player) => player.id === roomState.currentPlayerId) || null;
  }

  function cityCount(player) {
    return roomState?.spaces.filter((space) => space.ownerId === player.id).length || 0;
  }

  function positionFor(player, sameSpaceIndex, sameSpaceCount) {
    const point = player.position === 0
      ? { left: 92.2, top: 84 }
      : tilePosition(player.position - 1);
    const columns = Math.min(4, sameSpaceCount);
    const rows = Math.ceil(sameSpaceCount / columns);
    const column = sameSpaceIndex % columns;
    const row = Math.floor(sameSpaceIndex / columns);
    const horizontalOffset = (column - (columns - 1) / 2) * 2.05;
    const verticalOffset = -4 - row * 1.65;
    return { left: point.left + horizontalOffset, top: point.top + verticalOffset, compact: sameSpaceCount > 4 };
  }

  function renderTokens() {
    if (!roomState) {
      elements.tokens.replaceChildren();
      tokenElements.clear();
      return;
    }
    const groups = new Map();
    roomState.players.forEach((player) => {
      if (!groups.has(player.position)) groups.set(player.position, []);
      groups.get(player.position).push(player);
    });
    roomState.players.forEach((player) => {
      let token = tokenElements.get(player.id);
      if (!token) {
        token = document.createElement("div");
        token.className = "king-token";
        token.innerHTML = tokenSvg(player.color);
        elements.tokens.append(token);
        tokenElements.set(player.id, token);
      } else if (token.dataset.color !== player.color) {
        token.innerHTML = tokenSvg(player.color);
      }
      token.dataset.color = player.color;
      token.title = `${player.name} · ${COLORS.find((color) => color.id === player.color)?.name || ""}`;
      token.setAttribute("aria-label", `${player.name} фишкасы`);
      const group = groups.get(player.position);
      const offset = positionFor(player, group.findIndex((candidate) => candidate.id === player.id), group.length);
      token.style.left = `${offset.left}%`;
      token.style.top = `${offset.top}%`;
      token.classList.toggle("current", player.id === roomState.currentPlayerId && !["lobby", "ended"].includes(roomState.phase));
      token.classList.toggle("compact", offset.compact);
      token.classList.toggle("disconnected", !player.connected);
    });
    for (const [id, token] of tokenElements) {
      if (!roomState.players.some((player) => player.id === id)) {
        token.remove();
        tokenElements.delete(id);
      }
    }
    for (const space of roomState.spaces) {
      if (space.type !== "city") continue;
      const tile = elements.board.querySelector(`[data-space="${space.number}"]`);
      const badge = tile?.querySelector(".tile-owner");
      const owner = roomState.players.find((player) => player.id === space.ownerId);
      if (!badge) continue;
      badge.hidden = !owner;
      badge.style.backgroundColor = owner ? COLORS.find((color) => color.id === owner.color)?.value || "" : "";
      tile.title = `${space.number}-ұяшық · ${space.city}${owner ? ` · Иесі: ${owner.name}` : " · Бос қала"}`;
    }
  }

  function renderPlayers() {
    const players = roomState?.players || [];
    elements.playerCount.textContent = `${players.length} / ${roomState?.maxPlayers || 12}`;
    if (!players.length) {
      elements.players.innerHTML = '<div class="empty-state">Бөлме ашылған соң ойыншылар осында көрінеді.</div>';
      return;
    }
    const sorted = [...players].sort((a, b) => b.score - a.score ||
      cityCount(b) - cityCount(a) || b.correct - a.correct);
    elements.players.replaceChildren();
    sorted.forEach((player, rank) => {
      const card = document.createElement("article");
      card.className = `player-card${player.id === roomState.currentPlayerId && !["lobby", "ended"].includes(roomState.phase) ? " active" : ""}`;
      card.style.setProperty("--player-color", COLORS.find((color) => color.id === player.color)?.value || "#ffffff");
      const cities = roomState.spaces.filter((space) => space.ownerId === player.id).map((space) => space.city);
      const buffs = [];
      if (player.extraMoves) buffs.push(`⚡ Қос жүріс ×${player.extraMoves}`);
      if (player.shields) buffs.push(`🛡️ Қорғаныс ×${player.shields}`);
      if (player.extraTime) buffs.push("⏳ +30 секунд");
      if (player.fiftyFifty) buffs.push("🎯 50/50");
      const achievements = (player.achievements || []).map((id) => ACHIEVEMENTS[id] || id);
      const status = !player.connected ? " · Байланыс үзілді" :
        player.finished ? " · Мәреге жетті" : ` · ${player.position === 0 ? "Старт" : `${player.position}/48`}`;
      card.innerHTML = `<div class="player-main"><span class="player-piece-mini" style="--player-color:${card.style.getPropertyValue("--player-color")}">${tokenSvg(player.color)}</span><span class="player-name">${escapeHtml(player.name)}${status}</span><span class="player-rank">${rank + 1}-орын</span></div>
        <div class="player-stats"><span>🏅 ${player.score} ұпай</span><span>🏰 ${cities.length} қала</span><span>⭐ ${player.stars}</span><span>✓ ${player.correct}</span><span>🔥 ${player.streak} қатар</span></div>
        <div class="player-extra"><strong>Қалалары:</strong> ${cities.length ? cities.map(escapeHtml).join(", ") : "әзірге жоқ"}<br><strong>Жетістіктері:</strong> ${achievements.length ? achievements.map(escapeHtml).join(", ") : "әзірге жоқ"}${buffs.length ? `<br><strong>Бонустары:</strong> ${escapeHtml(buffs.join(", "))}` : ""}</div>`;
      elements.players.append(card);
    });
  }

  function renderLog() {
    elements.log.replaceChildren();
    for (const message of roomState?.log || []) {
      const item = document.createElement("li");
      item.textContent = message;
      elements.log.append(item);
    }
  }

  function renderTurn() {
    const player = activePlayer();
    if (!roomState || roomState.phase === "lobby") {
      elements.turnLabel.textContent = "ОЙЫН БАСТАЛМАДЫ";
      elements.activePlayer.textContent = "Ойынға дайынсыз ба?";
      elements.turnHint.textContent = "Бөлме құрып, ойыншыларды шақырыңыз.";
      elements.roll.disabled = true;
      elements.extraMoveActions.hidden = true;
      return;
    }
    const isMyTurn = roomState.meId === roomState.currentPlayerId;
    const canUseExtraMove = Boolean(roomState.extraMoveOffer && isMyTurn &&
      roomState.phase === "ready" && !player?.finished);
    elements.turnLabel.textContent = roomState.phase === "ended" ? "ОЙЫН АЯҚТАЛДЫ" :
      `КЕЗЕК · ${roomState.currentTurn + 1}/${roomState.players.length}`;
    elements.activePlayer.textContent = roomState.phase === "ended" ? "Қорытынды дайын" : player?.name || "Ойыншы күтілуде";
    elements.turnHint.textContent = canUseExtraMove ? "Қосымша жүрісті қолданыңыз немесе кезекті аяқтаңыз." :
      roomState.phase === "ended" ? "Барлық белсенді ойыншы мәреге жетті." :
      player?.finished ? "Мәреге жеттіңіз. Қалған ойыншылар ойынын жалғастыруда." :
        roomState.phase === "waiting" ? "Ойыншылар қайта қосылғанша күтіңіз." :
          `${player?.position === 0 ? "Бастаудан шығу" : `Орны: ${player?.position}/48`} · Қаласы: ${player ? cityCount(player) : 0}`;
    elements.roll.disabled = !player || roomState.phase !== "ready" ||
      !isMyTurn || player.finished || roomState.turnRolls >= 2 ||
      (roomState.turnRolls === 1 && !roomState.extraMovePending);
    elements.extraMoveActions.hidden = Boolean(!roomState.extraMoveOffer || roomState.phase !== "ready");
    elements.useExtraMove.disabled = !canUseExtraMove;
    elements.endTurn.hidden = !roomState.extraMoveOffer;
    elements.endTurn.disabled = !canUseExtraMove;
    elements.leave.hidden = !roomState.meId;
  }

  function renderLobby() {
    const isHost = roomState?.meId === roomState?.hostId;
    elements.roomCode.textContent = roomState?.code || "";
    elements.lobbyCount.textContent = `${roomState?.players.length || 0} / ${roomState?.maxPlayers || 12}`;
    elements.lobbyList.replaceChildren();
    (roomState?.players || []).forEach((player) => {
      const row = document.createElement("div");
      row.className = "lobby-player";
      const color = COLORS.find((candidate) => candidate.id === player.color);
      row.innerHTML = `<span class="lobby-piece" style="--player-color:${color?.value || "#ffffff"}">${tokenSvg(player.color)}</span><span>${escapeHtml(player.name)}</span><span class="lobby-player-state">${player.connected ? (player.id === roomState.hostId ? "Хост" : "Дайын") : "Желіде емес"}</span>`;
      elements.lobbyList.append(row);
    });
    elements.lobbyWaiting.textContent = roomState?.players.length >= 2
      ? isHost ? "Ойыншылар дайын. Бастауды басыңыз." : "Хост ойынды бастағанша күтіңіз."
      : "Кемінде 2 ойыншы жиналғанша күтіңіз.";
    elements.startGame.classList.toggle("hidden", !isHost);
    elements.startGame.disabled = !isHost || (roomState?.players.filter((player) => player.connected).length || 0) < 2;
    updateColorAvailability();
  }

  function renderSummary() {
    const ranking = [...roomState.players].sort((a, b) => b.score - a.score ||
      cityCount(b) - cityCount(a) || b.correct - a.correct);
    const first = ranking[0];
    const tied = roomState.tied;
    elements.summaryTitle.textContent = tied ? "Тең нәтиже!" : `Жеңімпаз: ${first?.name || ""}`;
    elements.summaryIntro.textContent = tied
      ? "Ұпай, қала және дұрыс жауап саны тең."
      : "Қорытынды ұпай, қала саны және дұрыс жауап бойынша есептелді.";
    elements.summaryList.replaceChildren();
    ranking.forEach((player, index) => {
      const row = document.createElement("div");
      row.className = `summary-row${index === 0 && !tied ? " winner" : ""}`;
      const cities = roomState.spaces.filter((space) => space.ownerId === player.id).map((space) => space.city);
      row.innerHTML = `<span class="summary-rank">${index + 1}.</span><span class="summary-name">${escapeHtml(player.name)}</span><span class="summary-score">${player.score} ұпай</span>
        <span class="summary-detail">Дұрыс жауап: ${player.correct} · Қала: ${cities.length ? cities.map(escapeHtml).join(", ") : "жоқ"} · ⭐ ${player.stars} · Жетістік: ${(player.achievements || []).map((id) => escapeHtml(ACHIEVEMENTS[id] || id)).join(", ") || "жоқ"}</span>`;
      elements.summaryList.append(row);
    });
    elements.summary.classList.remove("hidden");
  }

  function showQuestion() {
    const question = roomState.question;
    if (!question) return;
    const isCurrentPlayer = roomState.meId === question.playerId;
    const result = roomState.phase === "answerResult" ? roomState.answerResult : null;
    elements.questionCategory.textContent = question.kind === "city" ? `🏰 Қаланы иелену · ${question.city}` :
      question.kind === "attack" ? `⚔️ Қаланы қорғау · ${question.city}` :
        question.kind === "hard" ? "📜 Күрделі тарихи сұрақ" : question.category;
    elements.questionTitle.textContent = question.text;
    elements.questionNote.textContent = question.kind === "hard" ? "Дұрыс жауап: +20 ұпай · күрделі сұрақ үшін +50" : "Дұрыс жауап: +20 ұпай";
    if (currentQuestionId !== question.id) {
      currentQuestionId = question.id;
      elements.answers.replaceChildren();
      question.answers.forEach((answer) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "answer-button";
        button.dataset.answer = String(answer.index);
        button.textContent = `${String.fromCharCode(65 + answer.index)}. ${answer.text}`;
        button.addEventListener("click", () => {
          if (roomState?.phase !== "question" || roomState.meId !== question.playerId) return;
          socket.emit("answerQuestion", { questionId: question.id, answerIndex: answer.index });
        });
        elements.answers.append(button);
      });
    } else {
      const present = new Set(question.answers.map((answer) => answer.index));
      for (const button of elements.answers.querySelectorAll(".answer-button")) {
        if (!present.has(Number(button.dataset.answer))) button.remove();
      }
    }
    const remaining = Math.max(0, Math.ceil((question.deadline - Date.now()) / 1000));
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    elements.questionTimer.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    elements.questionTimer.classList.toggle("urgent", remaining <= 10);
    elements.timerBar.style.width = `${Math.max(0, remaining / question.duration * 100)}%`;
    elements.timerBar.style.background = remaining <= 10 ? "#f47e6f" : "";
    elements.questionFeedback.textContent = result?.message || "";
    elements.questionFeedback.className = `answer-feedback${result ? result.correct ? " good" : " bad" : ""}`;
    for (const button of elements.answers.querySelectorAll(".answer-button")) {
      const answer = Number(button.dataset.answer);
      button.disabled = !!result || !isCurrentPlayer;
      button.classList.toggle("correct", !!result && answer === result.correctIndex);
      button.classList.toggle("incorrect", !!result && answer !== result.correctIndex && answer === result.submittedIndex);
    }
    elements.fifty.hidden = !isCurrentPlayer || roomState.phase !== "question" || question.answers.length !== 4 ||
      !roomState.players.find((player) => player.id === roomState.meId)?.fiftyFifty;
    elements.fifty.onclick = () => socket.emit("useFiftyFifty", { questionId: question.id });
    elements.questionContinue.classList.add("hidden");
    elements.questionModal.classList.remove("hidden");
  }

  function renderReward() {
    if (roomState.phase !== "reward" || !roomState.reward) {
      elements.rewardModal.classList.add("hidden");
      return;
    }
    elements.rewardIcon.textContent = roomState.reward.icon;
    elements.rewardEyebrow.textContent = roomState.rewardSource || "СЫЙЛЫҚ";
    elements.rewardTitle.textContent = roomState.reward.title;
    elements.rewardDescription.textContent = roomState.reward.description;
    elements.rewardContinue.disabled = roomState.meId !== roomState.currentPlayerId;
    elements.rewardModal.classList.remove("hidden");
  }

  function startDiceOverlay(value) {
    clearTimeout(overlayTimer);
    elements.diceOverlay.classList.remove("hidden", "show-result");
    elements.diceCube.classList.remove("dice-spin");
    void elements.diceCube.offsetWidth;
    elements.diceCube.classList.add("dice-spin");
    elements.diceNumber.textContent = "";
    window.setTimeout(() => {
      elements.diceNumber.textContent = String(value);
      elements.diceOverlay.classList.add("show-result");
    }, 1050);
    elements.rollResult.textContent = "Кубик лақтырылуда…";
    overlayTimer = window.setTimeout(() => {
      elements.diceOverlay.classList.add("hidden");
      elements.diceOverlay.classList.remove("show-result");
    }, 1850);
  }

  function applyState(next) {
    if (!next || !Array.isArray(next.players) || !Array.isArray(next.spaces)) return;
    const previousPhase = lastPhase;
    roomState = next;
    if (roomState.meId) {
      savedIdentity = { code: roomState.code, playerId: roomState.meId };
      try {
        localStorage.setItem(identityKey(roomState.code), roomState.meId);
        sessionStorage.setItem("historic-table-last-room", roomState.code);
      } catch {
        showError("Қайта қосылу дерегін браузерде сақтау мүмкін болмады.");
      }
    }
    if (roomState.phase === "lobby") {
      elements.setup.classList.remove("hidden");
      elements.entryActions.classList.add("hidden");
      elements.createForm.classList.add("hidden");
      elements.joinForm.classList.add("hidden");
      elements.lobby.classList.remove("hidden");
      elements.backEntry.classList.add("hidden");
      elements.setupError.textContent = "";
      renderLobby();
    } else {
      elements.setup.classList.add("hidden");
      elements.leave.hidden = false;
    }
    if (!elements.board.querySelector(".tile")) buildBoard(roomState.spaces);
    else {
      roomState.spaces.forEach((space) => {
        const tile = elements.board.querySelector(`[data-space="${space.number}"]`);
        const badge = tile?.querySelector(".tile-owner");
        const owner = roomState.players.find((player) => player.id === space.ownerId);
        if (badge) {
          badge.hidden = !owner;
          badge.style.backgroundColor = owner ? COLORS.find((color) => color.id === owner.color)?.value || "" : "";
        }
      });
    }
    renderTokens();
    renderPlayers();
    renderLog();
    renderTurn();
    if (roomState.phase === "diceRolling" && previousPhase !== "diceRolling") startDiceOverlay(roomState.diceValue);
    if (roomState.phase === "question" || roomState.phase === "answerResult") showQuestion();
    else {
      elements.questionModal.classList.add("hidden");
      currentQuestionId = null;
    }
    renderReward();
    if (roomState.phase === "ended") renderSummary();
    else elements.summary.classList.add("hidden");
    if (previousPhase === "moving" && ["question", "reward", "ready", "ended"].includes(roomState.phase)) {
      const player = roomState.players.find((candidate) => candidate.id === roomState.currentPlayerId);
      const space = roomState.spaces[player?.position - 1];
      if (space) elements.rollResult.textContent = `${roomState.diceValue} түсті · ${space.number}-ұяшық${space.city ? ` · ${space.city}` : ""}`;
    }
    lastPhase = roomState.phase;
  }

  function identityKey(code) {
    let tabId = sessionStorage.getItem("historic-table-tab");
    if (!tabId) {
      tabId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      sessionStorage.setItem("historic-table-tab", tabId);
    }
    return `historic-table:${code}:${tabId}`;
  }

  function showError(message) {
    elements.setupError.textContent = message;
    if (toastTimer) clearTimeout(toastTimer);
    if (!elements.setup.classList.contains("hidden")) return;
    elements.entryActions.classList.remove("hidden");
    elements.createForm.classList.add("hidden");
    elements.joinForm.classList.add("hidden");
    elements.lobby.classList.add("hidden");
    elements.backEntry.classList.add("hidden");
    elements.setup.classList.remove("hidden");
    toastTimer = setTimeout(() => {
      if (roomState && roomState.phase !== "lobby") elements.setup.classList.add("hidden");
    }, 4500);
  }

  function action(event, payload) {
    return new Promise((resolve) => {
      socket.emit(event, payload, (result) => {
        if (!result?.ok) {
          showError(result?.error || "Әрекетті орындау мүмкін болмады.");
          resolve(false);
          return;
        }
        resolve(true);
      });
    });
  }

  function showEntry(mode) {
    currentMode = mode;
    elements.entryActions.classList.add("hidden");
    elements.createForm.classList.toggle("hidden", mode !== "create");
    elements.joinForm.classList.toggle("hidden", mode !== "join");
    elements.lobby.classList.add("hidden");
    elements.backEntry.classList.remove("hidden");
    elements.setupError.textContent = "";
  }

  function resetEntry() {
    currentMode = "";
    roomState = null;
    savedIdentity = null;
    joinAvailableColors = new Set();
    checkedRoomCode = "";
    elements.joinColor.disabled = true;
    tokenElements.clear();
    elements.tokens.replaceChildren();
    elements.entryActions.classList.remove("hidden");
    elements.createForm.classList.add("hidden");
    elements.joinForm.classList.add("hidden");
    elements.lobby.classList.add("hidden");
    elements.backEntry.classList.add("hidden");
    elements.setupError.textContent = "";
  }

  async function createRoom() {
    const name = elements.createName.value.trim();
    if (!name) return showError("Есіміңізді міндетті түрде енгізіңіз.");
    if (name.length > 16) return showError("Есім 16 таңбадан аспауы керек.");
    elements.createButton.disabled = true;
    await action("createRoom", {
      name,
      color: elements.createColor.value,
      maxPlayers: Number(elements.createLimit.value)
    });
    elements.createButton.disabled = false;
  }

  async function joinRoom(code = elements.joinCode.value, name = elements.joinName.value, color = elements.joinColor.value) {
    const cleanCode = String(code).replace(/\D/g, "").slice(0, 6);
    if (cleanCode.length < 4) return showError("Код кемінде 4 саннан тұруы керек");
    const cleanName = String(name).trim();
    if (!cleanName) return showError("Есіміңізді міндетті түрде енгізіңіз.");
    if (cleanName.length > 16) return showError("Есім 16 таңбадан аспауы керек.");
    if (checkedRoomCode !== cleanCode) {
      const info = await new Promise((resolve) => {
        socket.emit("roomInfo", { code: cleanCode }, resolve);
      });
      if (!info?.ok) return showError(info?.error || "Бөлмені тексеру мүмкін болмады.");
      checkedRoomCode = cleanCode;
      joinAvailableColors = new Set(info.availableColors);
      elements.joinColor.disabled = false;
      updateColorAvailability();
      if (!joinAvailableColors.has(color)) color = elements.joinColor.value;
    }
    elements.joinButton.disabled = true;
    const joined = await action("joinRoom", { code: cleanCode, name: cleanName, color });
    elements.joinButton.disabled = false;
    if (joined) try { sessionStorage.setItem("historic-table-last-room", cleanCode); } catch { /* the current connection still works */ }
  }

  function showSpaceInfo(space) {
    if (!roomState || ["moving", "diceRolling", "question", "answerResult", "ended"].includes(roomState.phase)) return;
    const owner = roomState.players.find((player) => player.id === space.ownerId);
    elements.infoIcon.textContent = space.type === "city" ? "🏰" : space.type === "bonus" ? "🎁" :
      space.type === "chest" ? "🧰" : space.type === "star" ? "⭐" : "📜";
    elements.infoTitle.textContent = space.city || `${space.number}-ұяшық · ${typeLabel(space.type)}`;
    elements.infoDescription.textContent = space.type === "city"
      ? owner ? `Бұл қаланың қазіргі иесі — ${owner.name}. Қалаға түскен ойыншы оны тартып алуға тырыса алады.` : "Қала әзірге бос. Дұрыс тарихи жауап беріп, оны иеленіңіз."
        : space.type === "bonus" ? "Бұл ұяшық кездейсоқ бес бонустың бірін береді."
          : space.type === "chest" ? "Қазына сандығын ашып, жасырын сыйлық алыңыз."
            : space.type === "star" ? "Жұлдызша +30 ұпай береді. Үш жұлдызға арнайы сыйлық бар."
              : "Тарихи сұраққа дұрыс жауап берсеңіз, +20 ұпай аласыз.";
    elements.info.classList.remove("hidden");
  }

  function renderInitialBoard() {
    buildBoard(makeSpaces());
    renderPlayers();
    renderTurn();
  }

  elements.showCreate.addEventListener("click", () => showEntry("create"));
  elements.showJoin.addEventListener("click", () => showEntry("join"));
  elements.backEntry.addEventListener("click", resetEntry);
  elements.createButton.addEventListener("click", createRoom);
  elements.joinButton.addEventListener("click", () => joinRoom());
  elements.joinCode.addEventListener("input", () => {
    elements.joinCode.value = elements.joinCode.value.replace(/\D/g, "").slice(0, 6);
    elements.setupError.textContent = "";
    const code = elements.joinCode.value;
    clearTimeout(roomInfoTimer);
    if (code.length < 4) {
      checkedRoomCode = "";
      joinAvailableColors = new Set();
      elements.joinColor.disabled = true;
      updateColorAvailability();
      return;
    }
    roomInfoTimer = setTimeout(() => {
      socket.emit("roomInfo", { code }, (result) => {
        if (elements.joinCode.value !== code) return;
        if (!result?.ok) {
          checkedRoomCode = "";
          joinAvailableColors = new Set();
          elements.joinColor.disabled = true;
          updateColorAvailability();
          elements.setupError.textContent = result?.error || "";
          return;
        }
        elements.setupError.textContent = "";
        checkedRoomCode = code;
        joinAvailableColors = new Set(result.availableColors);
        elements.joinColor.disabled = false;
        updateColorAvailability();
      });
    }, 100);
  });
  elements.createColor.addEventListener("change", () => {
    if (roomState?.phase === "lobby") action("pickColor", { color: elements.createColor.value });
  });
  elements.joinColor.addEventListener("change", () => {
    if (roomState?.phase === "lobby") action("pickColor", { color: elements.joinColor.value });
  });
  elements.startGame.addEventListener("click", () => action("startGame", {}));
  elements.roll.addEventListener("click", () => {
    if (!elements.roll.disabled) action("rollDice", {});
  });
  elements.useExtraMove.addEventListener("click", () => {
    if (!elements.useExtraMove.disabled) action("useExtraMove", {});
  });
  elements.endTurn.addEventListener("click", () => {
    if (!elements.endTurn.disabled) action("endTurn", {});
  });
  elements.fifty.addEventListener("click", () => {
    if (roomState?.question) action("useFiftyFifty", { questionId: roomState.question.id });
  });
  elements.questionContinue.addEventListener("click", () => {});
  elements.rewardContinue.addEventListener("click", () => {
    if (!elements.rewardContinue.disabled) action("continueReward", {});
  });
  elements.copyCode.addEventListener("click", async () => {
    if (!roomState?.code) return;
    try {
      await navigator.clipboard.writeText(roomState.code);
      elements.copyCode.textContent = "Көшірілді ✓";
      setTimeout(() => { elements.copyCode.textContent = "Көшіру"; }, 1600);
    } catch {
      showError("Кодты көшіру мүмкін болмады. Кодты қолмен белгілеңіз.");
    }
  });
  elements.share.addEventListener("click", async () => {
    if (!roomState?.code) return;
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomState.code);
    try {
      if (navigator.share) await navigator.share({ title: "Тарихи үстел", text: `Ойын коды: ${roomState.code}`, url: url.href });
      else {
        await navigator.clipboard.writeText(url.href);
        elements.share.textContent = "Сілтеме көшірілді ✓";
        setTimeout(() => { elements.share.textContent = "Сілтемені бөлісу"; }, 1600);
      }
    } catch (error) {
      if (error?.name !== "AbortError") showError("Сілтемені бөлісу мүмкін болмады.");
    }
  });
  elements.leave.addEventListener("click", async () => {
    if (roomState?.meId) await action("leaveRoom", {});
    resetEntry();
    const url = new URL(window.location.href);
    url.searchParams.delete("room");
    window.history.replaceState({}, "", url);
    elements.setup.classList.remove("hidden");
    elements.questionModal.classList.add("hidden");
    elements.rewardModal.classList.add("hidden");
    elements.summary.classList.add("hidden");
    elements.diceOverlay.classList.add("hidden");
    elements.leave.hidden = true;
    elements.rollResult.textContent = "";
    lastPhase = "";
    renderInitialBoard();
  });
  elements.infoClose.addEventListener("click", () => elements.info.classList.add("hidden"));
  elements.info.addEventListener("click", (event) => {
    if (event.target === elements.info) elements.info.classList.add("hidden");
  });
  elements.replay.addEventListener("click", () => {
    if (roomState?.meId) socket.emit("leaveRoom", {});
    elements.summary.classList.add("hidden");
    elements.setup.classList.remove("hidden");
    resetEntry();
    const url = new URL(window.location.href);
    url.searchParams.delete("room");
    window.history.replaceState({}, "", url);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.info.classList.contains("hidden")) elements.info.classList.add("hidden");
  });

  socket.on("colors", (colors) => {
    if (Array.isArray(colors) && colors.length === COLORS.length) knownColors = colors;
    populateColorSelect(elements.createColor);
    populateColorSelect(elements.joinColor);
  });
  socket.on("stateUpdate", applyState);
  socket.on("playerJoined", () => {
    if (roomState?.phase === "lobby") renderLobby();
  });
  socket.on("playerLeft", () => {
    if (roomState?.phase === "lobby") renderLobby();
  });
  socket.on("actionError", ({ message }) => showError(message));
  socket.on("roomExpired", ({ message }) => {
    resetEntry();
    elements.setup.classList.remove("hidden");
    showError(message);
  });
  socket.on("connect", () => {
    let code = new URL(window.location.href).searchParams.get("room") || "";
    let playerId = "";
    try {
      if (!code) code = sessionStorage.getItem("historic-table-last-room") || "";
      if (code) playerId = localStorage.getItem(identityKey(code)) || "";
    } catch {
      showError("Браузерде қайта қосылу дерегін оқу мүмкін болмады.");
    }
    if (code && playerId) {
      socket.emit("reconnect", { code, playerId }, (result) => {
        if (!result?.ok) {
          try { localStorage.removeItem(identityKey(code)); } catch { /* the join form remains available */ }
          elements.joinCode.value = code;
          showEntry("join");
        }
      });
    } else if (code) {
      elements.joinCode.value = code;
      showEntry("join");
    }
  });
  socket.on("disconnect", () => {
    elements.roll.disabled = true;
    showError("Сервермен байланыс үзілді. Қайта қосылу әрекеті жүріп жатыр.");
  });
  socket.on("connect_error", () => showError("Серверге қосыла алмады. Кейінірек қайталап көріңіз."));

  renderInitialBoard();
  elements.joinColor.disabled = true;
  populateColorSelect(elements.createColor);
  populateColorSelect(elements.joinColor);
})();
