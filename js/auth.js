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
  }
};
