(() => {
  'use strict';

  // =====================================================
  // FOCUSMATE — FIREBASE AUTHENTICATION + STUDY FEATURES
  // Uses Firebase compat SDK and Firestore
  // =====================================================

  const $ = id => document.getElementById(id);

  const KEY = 'focusmate_starter_v1';

  const today = () => new Date().toISOString().slice(0, 10);

  const makeId = () =>
    Math.random().toString(36).slice(2, 11);

  let firebaseReady = false;
  let auth = null;
  let db = null;
  let currentUser = null;
  let cloudSaveTimer = null;
  let loadingCloud = false;

  // ---------------- FIREBASE INITIALIZATION ----------------

  try {
    if (typeof firebase !== 'undefined' && firebase.initializeApp) {
      const config = window.firebaseConfig || (typeof firebaseConfig !== 'undefined' ? firebaseConfig : null);
      if (config && !firebase.apps.length) {
        firebase.initializeApp(config);
      }
      if (firebase.apps.length) {
        auth = firebase.auth();
        db = firebase.firestore();
        firebaseReady = true;
      }
    } else {
      console.warn('Firebase CDN not loaded. Running in local-only mode.');
    }
  } catch (error) {
    console.error('Firebase initialization error:', error);
  }


  // ---------------- DEFAULT DATA ----------------

  const fresh = () => ({
    stars: 0,
    focus: 0,
    tasks: [],
    notes: [{
      id: 'first',
      title: 'My first notebook',
      subject: 'Mathematics',
      topic: 'Getting started',
      text: 'Welcome to FocusMate! Write your ideas here.',
      drawing: ''
    }],
    active: 'first',
    cards: [],
    sessions: [],
    badges: [],
    unlocked: ['lavender'],
    theme: 'lavender',
    plan: []
  });

  function loadLocalData() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      const defaults = fresh();

      return {
        ...defaults,
        ...saved,
        tasks: Array.isArray(saved.tasks) ? saved.tasks : [],
        notes: Array.isArray(saved.notes) && saved.notes.length
          ? saved.notes : defaults.notes,
        cards: Array.isArray(saved.cards) ? saved.cards : [],
        sessions: Array.isArray(saved.sessions) ? saved.sessions : [],
        badges: Array.isArray(saved.badges) ? saved.badges : [],
        unlocked: Array.isArray(saved.unlocked)
          ? saved.unlocked : ['lavender'],
        plan: Array.isArray(saved.plan) ? saved.plan : []
      };
    } catch (error) {
      console.error('Local data error:', error);
      return fresh();
    }
  }

  let d = loadLocalData();

  let noteId = d.active || d.notes[0].id;
  let seconds = 1500;
  let total = 1500;
  let interval = null;
  let running = false;
  let eraser = false;
  let last = null;
  let drawing = false;
  let alarmObjectUrl = null;
  let installPrompt = null;
  let quizCard = null;

  // ---------------- THEMES AND BADGES ----------------

  const themes = [
    ['lavender', 'Lavender cloud', 0,
      'linear-gradient(90deg,#f7f3ff,#8b6ce8)'],
    ['mint', 'Mint garden', 20,
      'linear-gradient(90deg,#effaf5,#3d9d85)'],
    ['peach', 'Peach daydream', 35,
      'linear-gradient(90deg,#fff4ee,#dc8b75)'],
    ['night', 'Midnight study', 50,
      'linear-gradient(90deg,#201d32,#a58af7)']
  ];

  const badges = [
    ['first', '🌱', 'First little step',
      'Finish a focus session', () => d.sessions.length >= 1],
    ['three', '🌟', 'Finding a rhythm',
      'Finish 3 sessions', () => d.sessions.length >= 3],
    ['tasks', '✅', 'Task tamer',
      'Complete 5 tasks', () => d.tasks.filter(t => t.done).length >= 5],
    ['notes', '📓', 'Thought collector',
      'Save 3 notebooks', () => d.notes.length >= 3],
    ['cards', '🧠', 'Curious mind',
      'Create 5 flashcards', () => d.cards.length >= 5],
    ['stars', '✨', 'Star collector',
      'Earn 50 stars', () => d.stars >= 50]
  ];

  // ---------------- UTILITIES ----------------

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]);
  }

  function toast(message) {
    const element = $('toast');
    if (!element) {
      console.log(message);
      return;
    }

    element.textContent = message;
    element.classList.add('show');

    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      element.classList.remove('show');
    }, 2600);
  }

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = value;
  }

  function setHTML(id, value) {
    const element = $(id);
    if (element) element.innerHTML = value;
  }

  function bind(id, event, handler) {
    const element = $(id);
    if (element) element.addEventListener(event, handler);
  }

  // ---------------- LOCAL AND CLOUD STORAGE ----------------

  function save() {
    d.active = noteId;

    try {
      localStorage.setItem(KEY, JSON.stringify(d));
    } catch (error) {
      console.error('Local save error:', error);
      toast('Could not save locally. Storage may be full.');
    }

    render();

    if (currentUser && !loadingCloud) {
      scheduleCloudSave();
    }
  }

  function scheduleCloudSave() {
    clearTimeout(cloudSaveTimer);

    cloudSaveTimer = setTimeout(() => {
      saveToCloud(true);
    }, 1200);
  }

  async function saveToCloud(silent = false) {
    if (!firebaseReady || !db || !currentUser) {
      if (!silent) toast('Please log in before saving to the cloud.');
      return;
    }

    try {
      await db.collection('users')
        .doc(currentUser.uid)
        .set({
          data: JSON.parse(JSON.stringify(d)),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

      if (!silent) toast('Cloud backup saved successfully ☁️');

      setText('cloudStatus', 'Signed in: ' + currentUser.email);
    } catch (error) {
      console.error('Cloud save error:', error);

      if (!silent) {
        toast('Cloud save failed. Check your internet and Firestore rules.');
      }

      setText('cloudStatus', 'Cloud save failed');
    }
  }

  async function loadFromCloud(user) {
    if (!db || !user) return;

    loadingCloud = true;

    try {
      const ref = db.collection('users').doc(user.uid);
      const snapshot = await ref.get();

      if (snapshot.exists && snapshot.data().data) {
        const cloudData = snapshot.data().data;

        d = {
          ...fresh(),
          ...cloudData,
          tasks: Array.isArray(cloudData.tasks) ? cloudData.tasks : [],
          notes: Array.isArray(cloudData.notes) && cloudData.notes.length
            ? cloudData.notes : fresh().notes,
          cards: Array.isArray(cloudData.cards) ? cloudData.cards : [],
          sessions: Array.isArray(cloudData.sessions)
            ? cloudData.sessions : [],
          badges: Array.isArray(cloudData.badges) ? cloudData.badges : [],
          unlocked: Array.isArray(cloudData.unlocked)
            ? cloudData.unlocked : ['lavender'],
          plan: Array.isArray(cloudData.plan) ? cloudData.plan : []
        };

        noteId = d.active || d.notes[0].id;

        localStorage.setItem(KEY, JSON.stringify(d));
        render();
        toast('Your cloud data has been loaded ☁️');
      } else {
        await ref.set({
          data: JSON.parse(JSON.stringify(d)),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        toast('Your existing data was backed up ☁️');
      }
    } catch (error) {
      console.error('Cloud load error:', error);
      toast('Could not load cloud data. Your local data is preserved.');
    } finally {
      loadingCloud = false;
    }
  }

  // ---------------- AUTHENTICATION SCREEN ----------------

  function authMessage(message, isError = true) {
    const element = $('authMessage');

    if (element) {
      element.textContent = message;
      element.style.color = isError ? '#c0392b' : '#27834a';
    }
  }

  function switchAuthTab(mode) {
    const signup = mode === 'signup';

    const loginForm = $('loginForm');
    const signupForm = $('signupForm');
    const showLoginBtn = $('showLogin');
    const showSignupBtn = $('showSignup');

    if (loginForm) loginForm.hidden = signup;
    if (signupForm) signupForm.hidden = !signup;

    if (showLoginBtn) showLoginBtn.classList.toggle('active', !signup);
    if (showSignupBtn) showSignupBtn.classList.toggle('active', signup);

    authMessage('');
  }

  bind('showLogin', 'click', () => switchAuthTab('login'));
  bind('showSignup', 'click', () => switchAuthTab('signup'));

  function showLoginScreen() {
    if ($('authScreen')) $('authScreen').hidden = false;
    if ($('appHeader')) $('appHeader').hidden = true;
    if ($('appDashboard')) $('appDashboard').hidden = true;

    setText('cloudStatus', 'Not signed in');

    const logout = $('logoutBtn');
    if (logout) logout.remove();
  }

  function showDashboard(user) {
    if ($('authScreen')) $('authScreen').hidden = true;
    if ($('appHeader')) $('appHeader').hidden = false;
    if ($('appDashboard')) $('appDashboard').hidden = false;

    setText('cloudStatus', 'Signed in: ' + (user.email || 'Account'));

    let logout = $('logoutBtn');

    if (!logout) {
      const headerControls = document.querySelector('#appHeader > div');

      if (headerControls) {
        logout = document.createElement('button');
        logout.id = 'logoutBtn';
        logout.type = 'button';
        logout.textContent = 'Log Out';
        headerControls.appendChild(logout);
      }
    }

    if (logout) {
      logout.onclick = async () => {
        try {
          await saveToCloud(true);
          await auth.signOut();
          authMessage('You have logged out successfully.', false);
        } catch (error) {
          console.error('Logout error:', error);
          toast('Could not log out. Please try again.');
        }
      };
    }
  }

  bind('loginForm', 'submit', async event => {
    event.preventDefault();

    if (!firebaseReady || !auth) {
      authMessage('Firebase is not ready. Check your configuration.');
      return;
    }

    const email = $('loginEmail')?.value.trim();
    const password = $('loginPassword')?.value;
    const button = $('loginForm')?.querySelector('[type="submit"]');

    if (!email || !password) {
      authMessage('Enter your email and password.');
      return;
    }

    if (button) button.disabled = true;
    authMessage('Signing you in...', false);

    try {
      await auth.signInWithEmailAndPassword(email, password);
      authMessage('Login successful!', false);
    } catch (error) {
      console.error('Login error:', error);

      const messages = {
        'auth/invalid-email': 'Enter a valid email address.',
        'auth/user-not-found': 'No account found. Please sign up first.',
        'auth/wrong-password': 'Incorrect email or password.',
        'auth/invalid-credential': 'Incorrect email or password.',
        'auth/too-many-requests': 'Too many attempts. Try again later.',
        'auth/network-request-failed': 'Network error. Check your internet.'
      };

      authMessage(messages[error.code] || 'Login failed. Please try again.');
    } finally {
      if (button) button.disabled = false;
    }
  });

  bind('signupForm', 'submit', async event => {
    event.preventDefault();

    if (!firebaseReady || !auth) {
      authMessage('Firebase is not ready. Check your configuration.');
      return;
    }

    const email = $('signupEmail')?.value.trim();
    const password = $('signupPassword')?.value;
    const confirmation = $('confirmPassword')?.value;
    const button = $('signupForm')?.querySelector('[type="submit"]');

    if (!email || !password) {
      authMessage('Enter your email and password.');
      return;
    }

    if (password.length < 6) {
      authMessage('Your password must be at least 6 characters.');
      return;
    }

    if (password !== confirmation) {
      authMessage('Your passwords do not match.');
      return;
    }

    if (button) button.disabled = true;
    authMessage('Creating your account...', false);

    try {
      await auth.createUserWithEmailAndPassword(email, password);
      authMessage('Account created successfully!', false);
    } catch (error) {
      console.error('Sign-up error:', error);

      const messages = {
        'auth/email-already-in-use': 'This email already has an account. Log in instead.',
        'auth/invalid-email': 'Enter a valid email address.',
        'auth/weak-password': 'Choose a stronger password.',
        'auth/network-request-failed': 'Network error. Check your internet.'
      };

      authMessage(messages[error.code] || 'Could not create your account.');
    } finally {
      if (button) button.disabled = false;
    }
  });

  if (auth) {
    auth.onAuthStateChanged(async user => {
      currentUser = user || null;

      if (user) {
        showDashboard(user);
        await loadFromCloud(user);
        render();
      } else {
        showLoginScreen();
      }
    });
  } else {
    showLoginScreen();
    authMessage('Firebase failed to initialize. Check firebase-config.js.');
  }

  // ---------------- RENDERING ----------------

  function render() {
    setText('focusStat', d.focus + ' min');
    setText('taskStat', d.tasks.filter(t => t.done).length);
    setText('starsStat', d.stars);
    setText('badgeStat', d.badges.length);

    renderTasks();
    renderHome();
    renderNotes();
    renderCards();
    renderRewards();
    renderSessions();

    document.body.dataset.theme =
      d.theme === 'lavender' ? '' : d.theme;
  }

  function renderTasks() {
    setHTML('tasks', d.tasks.map(task => `
      <div class="item ${task.done ? 'done' : ''}">
        <input type="checkbox"
          data-check="${esc(task.id)}"
          ${task.done ? 'checked' : ''}>
        <span>
          ${esc(task.title)}
          <small>${esc(task.subject || 'General')}${
            task.date ? ' · ' + esc(task.date) : ''
          }</small>
        </span>
        <button data-del-task="${esc(task.id)}">×</button>
      </div>
    `).join('') || '<p class="hint">No tasks yet. Add a small step.</p>');
  }

  function renderHome() {
    setHTML('homeTasks', d.tasks.filter(t => !t.done).slice(0, 4).map(task => `
      <div class="item">
        <span>${esc(task.title)}
          <small>${esc(task.subject || 'General')}</small>
        </span>
        <button data-check-home="${esc(task.id)}">Done</button>
      </div>
    `).join('') || '<p class="hint">Your next little win will appear here.</p>');
  }

  function renderNotes() {
    setHTML('notebookList', d.notes.map(note => `
      <div class="item">
        <button data-open-note="${esc(note.id)}">📓</button>
        <span>${esc(note.title || 'Untitled')}
          <small>${esc(note.subject || 'Other')}</small>
        </span>
      </div>
    `).join(''));

    const note = d.notes.find(n => n.id === noteId);

    if (note) {
      if ($('noteTitle'))$('noteTitle').value = note.title || '';
      if ($('noteSubject'))$('noteSubject').value = note.subject || 'Other';
      if ($('noteTopic'))$('noteTopic').value = note.topic || '';
      if ($('noteText'))$('noteText').value = note.text || '';

      if (typeof draw === 'function') draw(note.drawing || '');
    }
  }

  function renderCards() {
    setHTML('cards', d.cards.map(card => `
      <div class="item">
        <span><b>${esc(card.deck)}</b>
          <small>${esc(card.front)}</small>
        </span>
        <button data-delete-card="${esc(card.id)}">×</button>
      </div>
    `).join('') || '<p class="hint">No flashcards yet.</p>');
  }

  function renderRewards() {
    setHTML('badges', badges.map(badge => `
      <div class="item ${d.badges.includes(badge[0]) ? '' : 'locked'}">
        <span>${badge[1]} <b>${esc(badge[2])}</b>
          <small>${esc(badge[3])}</small>
        </span>
        ${d.badges.includes(badge[0]) ? '✓' : ''}
      </div>
    `).join(''));

    setHTML('themes', themes.map(theme => `
      <div class="item" data-theme="${theme[0]}">
        <span><b>${esc(theme[1])}</b>
          <small>${d.unlocked.includes(theme[0])
            ? (d.theme === theme[0] ? 'Selected' : 'Tap to use')
            : 'Unlock for ' + theme[2] + ' ⭐'}</small>
        </span>
        <i style="display:block;width:25px;height:25px;
          border-radius:8px;background:${theme[3]}"></i>
      </div>
    `).join(''));
  }

  function renderSessions() {
    setHTML('sessions', d.sessions.slice(0, 5).map(session => `
      <div class="item">
        <span>${esc(session.label)}
          <small>${new Date(session.at).toLocaleString()}</small>
        </span>
        <b>${session.minutes} min</b>
      </div>
    `).join('') || '<p class="hint">Completed sessions appear here.</p>');
  }

  function award() {
    const earned = [];

    badges.forEach(badge => {
      if (badge[4]() && !d.badges.includes(badge[0])) {
        d.badges.push(badge[0]);
        earned.push(badge[2]);
      }
    });

    if (earned.length) {
      toast('Badge earned: ' + earned.join(', ') + ' 🏅');
    }
  }

  // ---------------- NAVIGATION ----------------

  function view(id) {
    document.querySelectorAll('.view').forEach(element => {
      element.classList.toggle('active', element.id === id);
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (id === 'notebook') {
      setTimeout(resizeCanvas, 50);
    }
  }

  document.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => view(button.dataset.view));
  });

  bind('themeBtn', 'click', () => view('rewards'));

  // ---------------- TASKS ----------------

  function addTask() {
    const title = $('taskName')?.value.trim();
    if (!title) return toast('Add a task name first.');

    d.tasks.push({
      id: makeId(),
      title,
      subject: $('taskSubject')?.value || 'General',
      date: $('taskDate')?.value || '',
      done: false
    });

    if ($('taskName'))$('taskName').value = '';

    save();
    toast('Task added 🌱');
  }

  bind('addTask', 'click', addTask);

  document.addEventListener('click', event => {
    const check = event.target.closest('[data-check], [data-check-home]');

    if (check) {
      const taskId = check.dataset.check || check.dataset.checkHome;
      const task = d.tasks.find(t => t.id === taskId);

      if (task && !task.done) {
        task.done = true;
        d.stars += 2;
        award();
        toast('Task complete! +2 stars ⭐');
      }

      save();
    }

    const removeTask = event.target.closest('[data-del-task]');

    if (removeTask) {
      d.tasks = d.tasks.filter(t => t.id !== removeTask.dataset.delTask);
      save();
    }

    const openNote = event.target.closest('[data-open-note]');

    if (openNote) {
      saveNote(true);
      noteId = openNote.dataset.openNote;
      renderNotes();
    }

    const removeCard = event.target.closest('[data-delete-card]');

    if (removeCard) {
      d.cards = d.cards.filter(c => c.id !== removeCard.dataset.deleteCard);
      save();
    }

    const themeButton = event.target.closest('[data-theme]');

    if (themeButton) {
      const theme = themes.find(t => t[0] === themeButton.dataset.theme);
      if (!theme) return;

      if (!d.unlocked.includes(theme[0])) {
        if (d.stars < theme[2]) {
          return toast('You need more stars to unlock this theme.');
        }

        if (!confirm(`Unlock ${theme[1]} for ${theme[2]} stars?`)) return;

        d.stars -= theme[2];
        d.unlocked.push(theme[0]);
      }

      d.theme = theme[0];
      save();
      toast('Theme changed!');
    }
  });

  // ---------------- FOCUS TIMER ----------------

  function showTimer() {
    setText(
      'timer',
      String(Math.floor(seconds / 60)).padStart(2, '0') + ':' +
      String(seconds % 60).padStart(2, '0')
    );
  }

  function setTimer(value) {
    clearInterval(interval);
    interval = null;
    running = false;
    seconds = total = value;

    setText('startTimer', 'Start');
    showTimer();
  }

  function completeSession() {
    const minutes = Math.max(1, Math.round(total / 60));

    d.focus += minutes;
    d.stars += Math.max(1, Math.floor(minutes / 10));

    d.sessions.unshift({
      label: $('intention')?.value.trim() || 'Focus session',
      minutes,
      at: Date.now()
    });

    award();
    save();

    setText('startTimer', 'Start');
    toast('Session complete! You earned stars ⭐');

    if ($('sound')?.checked) playAlarm();

    if ($('notify')?.checked && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification('FocusMate', {
          body: 'Well done! Your focus session is complete.'
        });
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
          if (permission === 'granted') {
            new Notification('FocusMate', {
              body: 'Your focus session is complete.'
            });
          }
        });
      }
    }
  }

  bind('startTimer', 'click', () => {
    if (running) {
      clearInterval(interval);
      interval = null;
      running = false;
      setText('startTimer', 'Resume');
      return;
    }

    running = true;
    setText('startTimer', 'Pause');

    interval = setInterval(() => {
      seconds--;
      showTimer();

      if (seconds <= 0) {
        clearInterval(interval);
        interval = null;
        running = false;
        completeSession();
      }
    }, 1000);
  });

  bind('resetTimer', 'click', () => setTimer(total));

  document.querySelectorAll('[data-min]').forEach(button => {
    button.addEventListener('click', () => {
      const minutes = Number(button.dataset.min);
      if (minutes > 0) setTimer(minutes * 60);

      if (button.dataset.view === 'focus') view('focus');
    });
  });

  bind('customTimer', 'click', () => {
    const minutes = Number($('customMinutes')?.value);

    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 180) {
      return toast('Choose 1–180 minutes.');
    }

    setTimer(minutes * 60);
  });

  // ---------------- ALARM SOUNDS ----------------

  function chime(mode = 'chime') {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContextClass();
      const tones = mode === 'bell'
        ? [523, 659, 784, 1046, 784, 1046]
        : [660, 880, 990];

      tones.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const at = context.currentTime + index * (mode === 'bell' ? 0.22 : 0.15);

        oscillator.type = mode === 'bell' ? 'triangle' : 'sine';
        oscillator.frequency.value = frequency;

        gain.gain.setValueAtTime(0.001, at);
        gain.gain.exponentialRampToValueAtTime(0.12, at + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.32);

        oscillator.connect(gain);
        gain.connect(context.destination);

        oscillator.start(at);
        oscillator.stop(at + 0.34);
      });

      setTimeout(() => context.close(), 1800);
    } catch (error) {
      console.error('Audio error:', error);
    }
  }

  function playAlarm() {
    const mode = $('alarmMode')?.value || 'chime';

    if (mode === 'music' && alarmObjectUrl) {
      const audio = $('alarmAudio');

      if (audio) {
        audio.src = alarmObjectUrl;
        audio.loop = true;
        audio.play().catch(() => {
          toast('Tap Test alarm first or choose another sound.');
        });
      }

      return;
    }

    chime(mode === 'bell' ? 'bell' : 'chime');
  }

  function stopAlarm() {
    const audio = $('alarmAudio');

    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  }

  bind('testAlarm', 'click', playAlarm);
  bind('stopAlarm', 'click', stopAlarm);

  bind('alarmFile', 'change', event => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (alarmObjectUrl) URL.revokeObjectURL(alarmObjectUrl);

    alarmObjectUrl = URL.createObjectURL(file);

    if ($('alarmMode'))$('alarmMode').value = 'music';
    toast('Alarm music ready for this session.');
  });

  // ---------------- NOTEBOOK AND DRAWING CANVAS ----------------

  const canvas = $('canvas');
  const ctx = canvas ? canvas.getContext('2d') : null;

  function draw(url) {
    if (!canvas || !ctx) return;

    const ratio = window.devicePixelRatio || 1;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!url) return;

    const image = new Image();

    image.onload = () => {
      ctx.drawImage(
        image, 0, 0,
        canvas.width / ratio,
        canvas.height / ratio
      );
    };

    image.src = url;
  }

  function resizeCanvas() {
    if (!canvas || !ctx) return;

    const oldDrawing = canvas.toDataURL();
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;

    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.round(220 * ratio);

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (oldDrawing && oldDrawing !== 'data:,') draw(oldDrawing);
  }

  function saveNote(silent = false) {
    const note = d.notes.find(n => n.id === noteId);
    if (!note) return;

    note.title = $('noteTitle')?.value.trim() || 'Untitled';
    note.subject = $('noteSubject')?.value || 'Other';
    note.topic = $('noteTopic')?.value || '';
    note.text = $('noteText')?.value || '';

    if (canvas) {
      try {
        note.drawing = canvas.toDataURL();
      } catch (error) {
        console.error('Drawing save error:', error);
      }
    }

    if (!silent) toast('Notebook saved');

    save();
  }

  bind('saveNote', 'click', () => saveNote());

  bind('newNote', 'click', () => {
    saveNote(true);

    const note = {
      id: makeId(),
      title: 'New notebook',
      subject: 'Mathematics',
      topic: '',
      text: '',
      drawing: ''
    };

    d.notes.push(note);
    noteId = note.id;

    save();
    view('notebook');
  });

  bind('deleteNote', 'click', () => {
    if (d.notes.length < 2) {
      return toast('Keep at least one notebook.');
    }

    if (!confirm('Delete this notebook?')) return;

    d.notes = d.notes.filter(n => n.id !== noteId);
    noteId = d.notes[0].id;

    save();
    renderNotes();
  });

  if (canvas && ctx) {
    function pointerPosition(event) {
      const rect = canvas.getBoundingClientRect();

      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };
    }

    canvas.addEventListener('pointerdown', event => {
      drawing = true;
      last = pointerPosition(event);
      canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener('pointermove', event => {
      if (!drawing || !last) return;

      const position = pointerPosition(event);

      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(position.x, position.y);
      ctx.lineWidth = Number($('penSize')?.value || 3);
      ctx.strokeStyle = eraser
        ? '#ffffff'
        : ($('penColor')?.value || '#333333');
      ctx.stroke();

      last = position;
    });

    ['pointerup', 'pointercancel', 'pointerleave'].forEach(name => {
      canvas.addEventListener(name, () => {
        if (drawing) {
          drawing = false;
          last = null;
          saveNote(true);
        }
      });
    });
  }

  bind('eraser', 'click', () => {
    eraser = !eraser;
    setText('eraser', eraser ? 'Pen mode' : 'Eraser');
  });

  bind('clearDraw', 'click', () => {
    if (!canvas || !ctx) return;

    if (confirm('Clear drawing?')) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      saveNote(true);
    }
  });

  window.addEventListener('resize', () => {
    if ($('notebook')?.classList.contains('active')) {
      resizeCanvas();

      const note = d.notes.find(n => n.id === noteId);
      if (note) draw(note.drawing || '');
    }
  });

  // ---------------- FLASHCARDS AND QUIZ ----------------

  bind('addCard', 'click', () => {
    const front = $('front')?.value.trim();
    const back = $('back')?.value.trim();

    if (!front || !back) {
      return toast('Add both a question and answer.');
    }

    d.cards.push({
      id: makeId(),
      front,
      back,
      deck: $('deckName')?.value.trim() || 'My deck'
    });

    $('front').value = '';$('back').value = '';

    award();
    save();
    toast('Flashcard saved 🃏');
  });

  bind('startQuiz', 'click', () => {
    if (!d.cards.length) {
      setText('quiz', 'Add a flashcard to begin.');
      return;
    }

    quizCard = d.cards[Math.floor(Math.random() * d.cards.length)];

    setHTML('quiz', `
      <b>${esc(quizCard.front)}</b>
      <p id="answer" hidden>${esc(quizCard.back)}</p>
      <button id="reveal">Reveal answer</button>
      <button id="knew" hidden>I knew it ✓</button>
      <button id="again" hidden>Practise again</button>
    `);

    bind('reveal', 'click', () => {
      if ($('answer'))$('answer').hidden = false;
      if ($('knew'))$('knew').hidden = false;
      if ($('again'))$('again').hidden = false;
    });

    bind('knew', 'click', () => {
      d.stars++;
      save();
      setText('feedback', 'Great recall! +1 star');
      $('startQuiz').click();
    });

    bind('again', 'click', () => {
      setText('feedback', 'No worries — practise makes progress.');
      $('startQuiz').click();
    });
  });

  // ---------------- STUDY PLANNER ----------------

  function fmt(minutes) {
    return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' +
      String(minutes % 60).padStart(2, '0');
  }

  bind('buildPlan', 'click', () => {
    const from = $('from')?.value;
    const until = $('until')?.value;
    const block = Number($('block')?.value);

    if (!from || !until || until <= from) {
      return toast('Choose an end time after the start time.');
    }

    if (!Number.isFinite(block) || block <= 0) {
      return toast('Choose a valid study block length.');
    }

    let start = Number(from.slice(0, 2)) * 60 + Number(from.slice(3));
    const end = Number(until.slice(0, 2)) * 60 + Number(until.slice(3));

    let tasks = d.tasks.filter(task => !task.done);

    if (!tasks.length) {
      tasks = [{ title: 'Review notes', subject: 'Study' }];
    }

    const output = [];

    while (start + block <= end && output.length < 12) {
      const task = tasks[output.length % tasks.length];
      const finish = start + block;

      output.push({
        start: fmt(start),
        finish: fmt(finish),
        title: task.title
      });

      start = finish + 5;
    }

    if (!output.length) {
      return toast('Not enough time for one full block.');
    }

    d.plan = output;
    save();

    setHTML('timetable', output.map(item => `
      <div class="item">
        <span>${esc(item.start)}–${esc(item.finish)} · ${esc(item.title)}</span>
      </div>
    `).join(''));
  });

  // ---------------- MUSIC PLAYER ----------------

  function embedMusic(raw) {
    let url;

    try {
      url = new URL(raw);
    } catch {
      return null;
    }

    if (url.hostname === 'youtu.be') {
      const videoId = url.pathname.slice(1).split('/')[0];

      return videoId ? {
        src: 'https://www.youtube-nocookie.com/embed/' +
          encodeURIComponent(videoId),
        type: 'youtube'
      } : null;
    }

    if (url.hostname === 'youtube.com' ||
        url.hostname.endsWith('.youtube.com')) {
      let videoId = url.searchParams.get('v');

      if (!videoId && url.pathname.startsWith('/embed/')) {
        videoId = url.pathname.split('/')[2];
      }

      if (!videoId && url.pathname.startsWith('/shorts/')) {
        videoId = url.pathname.split('/')[2];
      }

      return videoId ? {
        src: 'https://www.youtube-nocookie.com/embed/' +
          encodeURIComponent(videoId),
        type: 'youtube'
      } : null;
    }

    if (url.hostname === 'open.spotify.com') {
      const parts = url.pathname.split('/').filter(Boolean);

      if (parts.length >= 2 &&
          ['track', 'album', 'playlist', 'episode', 'show'].includes(parts[0])) {
        return {
          src: 'https://open.spotify.com/embed/' +
            parts.slice(0, 2).map(encodeURIComponent).join('/'),
          type: 'spotify'
        };
      }
    }

    return null;
  }

  bind('playLink', 'click', () => {
    const result = embedMusic($('musicUrl')?.value.trim() || '');

    if (!result) {
      return toast('Use a YouTube video or Spotify music link.');
    }

    setHTML('musicPlayer', `
      <iframe
        class="${result.type === 'spotify' ? 'spotify' : ''}"
        src="${result.src}"
        title="Music player"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        allowfullscreen
        loading="lazy"></iframe>
    `);
  });

  bind('clearPlayer', 'click', () => {
    setHTML('musicPlayer',
      '<p class="hint">Paste a supported link to play music.</p>');
  });

  // ---------------- BACKUP AND RESTORE ----------------

  bind('export', 'click', () => {
    const blob = new Blob([JSON.stringify(d, null, 2)], {
      type: 'application/json'
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'focusmate-backup.json';
    link.click();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  bind('import', 'change', event => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);

        if (!Array.isArray(imported.tasks) ||
            !Array.isArray(imported.notes)) {
          throw new Error('Invalid backup');
        }

        if (!confirm('Replace local data with this backup?')) return;

        d = { ...fresh(), ...imported };
        noteId = d.active || d.notes[0]?.id || 'first';

        save();
        toast('Backup imported successfully.');
      } catch (error) {
        toast('Invalid FocusMate backup file.');
      }
    };

    reader.readAsText(file);
    event.target.value = '';
  });

  // ---------------- ACCOUNT BUTTON ----------------

  bind('accountBtn', 'click', async () => {
    if (!currentUser) {
      toast('Please log in first.');
      return;
    }

    await saveToCloud(false);
  });

  // ---------------- INSTALLABLE PWA ----------------

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;

    if ($('installBtn'))$('installBtn').hidden = false;
  });

  bind('installBtn', 'click', async () => {
    if (!installPrompt) return;

    installPrompt.prompt();
    await installPrompt.userChoice;

    installPrompt = null;

    if ($('installBtn'))$('installBtn').hidden = true;
  });

  if ('serviceWorker' in navigator &&
      location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(error => {
      console.error('Service worker registration error:', error);
    });
  }

  // ---------------- INITIAL SETUP ----------------

  document.addEventListener('DOMContentLoaded', () => {
    if ($('taskDate'))$('taskDate').value = today();
    if ($('studyDate'))$('studyDate').value = today();

    setText(
      'greeting',
      new Date().getHours() < 12
        ? 'Good morning, study friend ☀️'
        : 'Ready for a little progress?'
    );

    render();
    setTimer(1500);
  });

})();