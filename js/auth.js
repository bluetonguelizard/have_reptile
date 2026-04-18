// Auth helpers using localStorage
const AUTH = {
  getUsers() {
    return JSON.parse(localStorage.getItem('tgs_users') || '{}');
  },
  saveUsers(users) {
    localStorage.setItem('tgs_users', JSON.stringify(users));
  },
  register(username, password) {
    const users = this.getUsers();
    if (users[username]) return { ok: false, err: 'err_exists' };
    users[username] = { password, lizardName: null, gameState: null };
    this.saveUsers(users);
    return { ok: true };
  },
  login(username, password) {
    const users = this.getUsers();
    if (!users[username] || users[username].password !== password)
      return { ok: false, err: 'err_notfound' };
    localStorage.setItem('tgs_current', username);
    return { ok: true, user: users[username] };
  },
  logout() {
    localStorage.removeItem('tgs_current');
  },
  currentUser() {
    const name = localStorage.getItem('tgs_current');
    if (!name) return null;
    const users = this.getUsers();
    return users[name] ? { username: name, ...users[name] } : null;
  },
  saveGameState(state) {
    const username = localStorage.getItem('tgs_current');
    if (!username) return;
    const users = this.getUsers();
    if (users[username]) {
      users[username].gameState = state;
      this.saveUsers(users);
    }
  },
  saveLizardName(name) {
    const username = localStorage.getItem('tgs_current');
    if (!username) return;
    const users = this.getUsers();
    if (users[username]) {
      users[username].lizardName = name;
      this.saveUsers(users);
    }
  },
  getLizards() {
    const name = localStorage.getItem('tgs_current');
    if (!name) return [];
    const users = this.getUsers();
    const user = users[name];
    if (!user) return [];
    // Migration: old single-lizard format
    if (user.gameState && !user.lizards) {
      const gs = { ...user.gameState };
      if (!gs.lizardName) gs.lizardName = user.lizardName || '';
      return [gs];
    }
    return user.lizards || [];
  },
  getActiveLizardIndex() {
    const name = localStorage.getItem('tgs_current');
    if (!name) return 0;
    const users = this.getUsers();
    const user = users[name];
    return (user && typeof user.activeLizardIndex === 'number') ? user.activeLizardIndex : 0;
  },
  saveAllLizards(lizards, activeIdx) {
    const username = localStorage.getItem('tgs_current');
    if (!username) return;
    const users = this.getUsers();
    if (users[username]) {
      users[username].lizards = lizards;
      users[username].activeLizardIndex = activeIdx;
      // Legacy compat: keep old fields pointing to active lizard
      if (lizards[activeIdx]) {
        users[username].gameState = lizards[activeIdx];
        users[username].lizardName = lizards[activeIdx].lizardName || '';
      }
      this.saveUsers(users);
    }
  },
  getAccountCoins() {
    const name = localStorage.getItem('tgs_current');
    if (!name) return 0;
    const users = this.getUsers();
    const user = users[name];
    return (user && typeof user.coins === 'number') ? user.coins : 0;
  },
  saveAccountCoins(amount) {
    const username = localStorage.getItem('tgs_current');
    if (!username) return;
    const users = this.getUsers();
    if (users[username]) {
      users[username].coins = amount;
      this.saveUsers(users);
    }
  },
  getIncubator() {
    const name = localStorage.getItem('tgs_current');
    if (!name) return [];
    const users = this.getUsers();
    const user = users[name];
    return (user && user.incubator) ? user.incubator : [];
  },
  saveIncubator(eggs) {
    const username = localStorage.getItem('tgs_current');
    if (!username) return;
    const users = this.getUsers();
    if (users[username]) {
      users[username].incubator = eggs;
      this.saveUsers(users);
    }
  }
};
