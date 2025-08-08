
/*
  main.js - Firestore-powered client logic for Eden Sales
  - Requires firebase-app-compat, firebase-auth-compat, firebase-firestore-compat included in the HTML
  - Expects `firebaseConfig` (object) to be defined on the page before this script loads.
  - Usage: upload this to your GitHub repo and include via raw.githubusercontent link.
*/

// Safety: do not hardcode production API keys here in public repos.
// This file assumes firebaseConfig is present in the page (so you can control it in HTML).
(function () {
  'use strict';

  // ----- Globals -----
  let app;
  let auth;
  let db;
  let currentUser = null; // { id, name, role }
  let isAdmin = false;

  // Local in-memory cache of collections (keeps UI fast)
  const state = {
    employees: [],
    stores: [],
    products: [],
    pricing: [],
    sales: []
  };

  // Snapshot unsubscribe functions
  const unsubscribes = [];

  // Admin backdoor credentials (you said admin/admin123)
  const BACKDOOR_USERNAME = 'admin';
  const BACKDOOR_PASSWORD = 'admin123';

  // Utility: safe console
  const log = (...args) => console.log('[Eden main.js]', ...args);
  const warn = (...args) => console.warn('[Eden main.js]', ...args);
  const err = (...args) => console.error('[Eden main.js]', ...args);

  // ----- Init Firebase (expects firebaseConfig on window) -----
  async function initFirebase() {
    if (!window.firebase) {
      err('Firebase SDK not found. Make sure you included firebase-app-compat, auth-compat, firestore-compat in your HTML.');
      return false;
    }

    if (!window.firebaseConfig || !window.firebaseConfig.projectId) {
      warn('firebaseConfig missing or incomplete on page. Please set firebaseConfig in the HTML (apiKey, projectId, etc.).');
      // still try to init if present partly
    }

    try {
      if (!firebase.apps.length) {
        app = firebase.initializeApp(window.firebaseConfig || {});
      } else {
        app = firebase.app();
      }
      auth = firebase.auth();
      db = firebase.firestore();

      // Enable offline persistence where possible
      try {
        await db.enablePersistence({ synchronizeTabs: true });
        log('Firestore persistence enabled.');
      } catch (pErr) {
        warn('Could not enable persistence (multiple tabs or unsupported browser).', pErr);
      }

      // Monitor auth state for convenience
      auth.onAuthStateChanged(user => {
        if (user) {
          log('Firebase auth active (uid):', user.uid);
        } else {
          log('Firebase signed out');
        }
      });

      return true;
    } catch (e) {
      err('Error initializing Firebase:', e);
      return false;
    }
  }

  // ----- Login logic -----
  async function handleLoginFormSubmit(e) {
    e.preventDefault();
    const username = (document.getElementById('username')?.value || '').trim();
    const password = (document.getElementById('password')?.value || '').trim();

    if (!username || !password) {
      alert('Please enter username and password.');
      return;
    }

    // Backdoor admin login (fast)
    if (username === BACKDOOR_USERNAME && password === BACKDOOR_PASSWORD) {
      isAdmin = true;
      currentUser = { id: 'admin', name: 'Admin', role: 'admin' };
      log('Backdoor admin logged in');
      await ensureSignedInAnonymously();
      postLoginInit();
      return;
    }

    // Try to lookup user in 'users' collection (password stored in plain text in example - replace with hashed in prod)
    try {
      const q = db.collection('users').where('username', '==', username).limit(1);
      const snap = await q.get();
      if (snap.empty) {
        alert('User not found');
        return;
      }
      let found = null;
      snap.forEach(doc => {
        const d = doc.data();
        // Example check - assumes users have `password` field (plain text). Replace in production.
        if (d.password && d.password === password) {
          found = { id: doc.id, ...d };
        }
      });
      if (!found) {
        alert('Invalid password');
        return;
      }
      currentUser = { id: found.id, name: found.name || found.username, role: found.role || 'employee' };
      isAdmin = currentUser.role === 'admin';
      await ensureSignedInAnonymously();
      postLoginInit();
    } catch (e) {
      err('Login error:', e);
      alert('Login failed (check console).');
    }
  }

  // Ensure an authenticated firebase user exists (anonymous sign-in if needed)
  async function ensureSignedInAnonymously() {
    try {
      if (!auth.currentUser) {
        await auth.signInAnonymously();
        log('Signed in anonymously for Firestore access');
      }
    } catch (e) {
      warn('Anonymous sign-in failed, you may have restricted Firestore rules requiring real auth.', e);
    }
  }

  // ----- After Login: set up real-time listeners and UI -----
  function postLoginInit() {
    hideElement('loginScreen');
    showElement('mainApp');
    setText('userWelcome', `Welcome, ${currentUser.name}`);
    setupRealtimeListeners();
    setupUIActions();
    log('Post-login initialization done.');
  }

  // ----- Real-time listeners for collections -----
  function setupRealtimeListeners() {
    // Clean up previous listeners
    unsubscribes.forEach(fn => fn && fn());
    unsubscribes.length = 0;

    // employees
    const empUnsub = db.collection('employees').onSnapshot(snap => {
      state.employees = [];
      snap.forEach(doc => state.employees.push({ id: doc.id, ...doc.data() }));
      renderEmployees();
      updateStats();
    }, e => err('Employees snapshot error', e));
    unsubscribes.push(empUnsub);

    // stores
    const storesUnsub = db.collection('stores').onSnapshot(snap => {
      state.stores = [];
      snap.forEach(doc => state.stores.push({ id: doc.id, ...doc.data() }));
      renderStores();
      updateStats();
    }, e => err('Stores snapshot error', e));
    unsubscribes.push(storesUnsub);

    // products
    const prodUnsub = db.collection('products').onSnapshot(snap => {
      state.products = [];
      snap.forEach(doc => state.products.push({ id: doc.id, ...doc.data() }));
      renderProducts();
      updateStats();
    }, e => err('Products snapshot error', e));
    unsubscribes.push(prodUnsub);

    // pricing (store-specific prices)
    const pricingUnsub = db.collection('pricing').onSnapshot(snap => {
      state.pricing = [];
      snap.forEach(doc => state.pricing.push({ id: doc.id, ...doc.data() }));
      renderPricing();
    }, e => err('Pricing snapshot error', e));
    unsubscribes.push(pricingUnsub);

    // sales (latest first)
    const salesUnsub = db.collection('sales').orderBy('createdAt', 'desc').limit(200).onSnapshot(snap => {
      state.sales = [];
      snap.forEach(doc => state.sales.push({ id: doc.id, ...doc.data() }));
      renderSales();
      updateStats();
    }, e => err('Sales snapshot error', e));
    unsubscribes.push(salesUnsub);

    log('Realtime listeners attached for employees, stores, products, pricing, and sales.');
  }

  // ----- UI renderers -----
  function renderEmployees() {
    const tbody = document.getElementById('employeesTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    state.employees.forEach(emp => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(emp.name || '')}</td>
                      <td>${escapeHtml(emp.role || '')}</td>
                      <td class="salary-column">${escapeHtml(emp.salaryType || '')}</td>
                      <td class="salary-column">${escapeHtml(emp.salaryAmount || '')}</td>
                      <td><button class="btn btn-danger" onclick="eden_deleteEmployee('${emp.id}')">Delete</button></td>`;
      tbody.appendChild(tr);
    });
  }

  function renderStores() {
    const tbody = document.getElementById('storesTable');
    const storeSelect = document.getElementById('saleStore');
    if (tbody) tbody.innerHTML = '';
    if (storeSelect) {
      // keep default option
      const defaultOpt = storeSelect.querySelector('option[value=""]');
      storeSelect.innerHTML = '';
      if (defaultOpt) storeSelect.appendChild(defaultOpt);
    }
    state.stores.forEach(st => {
      if (tbody) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(st.name || '')}</td>
                        <td>${escapeHtml(st.location || '')}</td>
                        <td>${escapeHtml(st.manager || '')}</td>
                        <td>${escapeHtml(st.phone || '')}</td>
                        <td><button class="btn btn-danger" onclick="eden_deleteStore('${st.id}')">Delete</button></td>`;
        tbody.appendChild(tr);
      }
      if (storeSelect) {
        const opt = document.createElement('option');
        opt.value = st.id;
        opt.textContent = st.name || st.id;
        storeSelect.appendChild(opt);
      }
    });
  }

  function renderProducts() {
    const tbody = document.getElementById('productsTable');
    const prodSelect = document.getElementById('saleProduct');
    if (tbody) tbody.innerHTML = '';
    if (prodSelect) {
      const defaultOpt = prodSelect.querySelector('option[value=""]');
      prodSelect.innerHTML = '';
      if (defaultOpt) prodSelect.appendChild(defaultOpt);
    }
    state.products.forEach(p => {
      if (tbody) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(p.name || '')}</td>
                        <td>${escapeHtml(p.basePrice || '')}</td>
                        <td>${escapeHtml(p.collection || '')}</td>
                        <td><button class="btn btn-danger" onclick="eden_deleteProduct('${p.id}')">Delete</button></td>`;
        tbody.appendChild(tr);
      }
      if (prodSelect) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name || p.id;
        prodSelect.appendChild(opt);
      }
    });
    updateTotal(); // refresh sale total when products change
  }

  function renderPricing() {
    const tbody = document.getElementById('pricingTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    state.pricing.forEach(pr => {
      const store = state.stores.find(s => s.id === pr.storeId)?.name || pr.storeId;
      const product = state.products.find(p => p.id === pr.productId)?.name || pr.productId;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(store)}</td>
                      <td>${escapeHtml(product)}</td>
                      <td>${escapeHtml(pr.basePrice || '')}</td>
                      <td>${escapeHtml(pr.storePrice || '')}</td>
                      <td>${escapeHtml((pr.storePrice - pr.basePrice) || '')}</td>
                      <td><button class="btn btn-danger" onclick="eden_deletePricing('${pr.id}')">Delete</button></td>`;
      tbody.appendChild(tr);
    });
  }

  function renderSales() {
    const container = document.getElementById('todaySalesList');
    const tableBody = document.getElementById('salesTableBody'); // if you have a sales table
    if (container) container.innerHTML = '';
    if (tableBody) tableBody.innerHTML = '';
    state.sales.forEach(s => {
      const el = document.createElement('div');
      el.className = 'sale-item';
      const productName = state.products.find(p => p.id === s.productId)?.name || s.productName || 'Unknown';
      const storeName = state.stores.find(st => st.id === s.storeId)?.name || s.storeName || 'Unknown';
      el.innerHTML = `<div class="sale-info"><div class="sale-product">${escapeHtml(productName)}</div>
                      <div class="sale-details">${escapeHtml(storeName)} • ${new Date((s.createdAt && s.createdAt.toDate) ? s.createdAt.toDate() : (s.createdAt || '')).toLocaleString()}</div></div>
                      <div class="sale-amount">$${Number(s.total || s.amount || 0).toFixed(2)}</div>`;
      if (container) container.appendChild(el);

      // optional table row
      if (tableBody) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(productName)}</td><td>${escapeHtml(storeName)}</td><td>${escapeHtml(s.quantity || 1)}</td><td>$${Number(s.total || s.amount || 0).toFixed(2)}</td>`;
        tableBody.appendChild(tr);
      }
    });
  }

  function updateStats() {
    // update small dashboard stats
    setText('todaySales', `$${sumRecentSalesAmount().toFixed(2)}`);
    setText('bottlesSold', `${sumRecentSalesQty()}`);
    setText('currentSalary', `$0`);
  }

  function sumRecentSalesAmount() {
    return state.sales.reduce((acc, s) => acc + (Number(s.total || s.amount || 0) || 0), 0);
  }
  function sumRecentSalesQty() {
    return state.sales.reduce((acc, s) => acc + (Number(s.quantity) || 1), 0);
  }

  // ----- Actions: Add sale, delete entities (examples) -----
  async function addSale({ storeId, productId, quantity, unitPrice, date, recordedBy }) {
    try {
      const doc = {
        storeId: storeId || null,
        productId: productId || null,
        productName: state.products.find(p => p.id === productId)?.name || '',
        storeName: state.stores.find(s => s.id === storeId)?.name || '',
        quantity: Number(quantity) || 1,
        unitPrice: Number(unitPrice) || 0,
        total: (Number(quantity) || 1) * (Number(unitPrice) || 0),
        recordedBy: recordedBy || (currentUser && currentUser.id) || null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      await db.collection('sales').add(doc);
      log('Sale recorded', doc);
      // UI will update via snapshot listener
    } catch (e) {
      err('Failed to record sale', e);
      alert('Failed to record sale (see console)');
    }
  }

  async function eden_deleteEmployee(id) {
    if (!confirm('Delete employee?')) return;
    try { await db.collection('employees').doc(id).delete(); } catch (e) { err(e); alert('Delete failed'); }
  }
  async function eden_deleteStore(id) {
    if (!confirm('Delete store?')) return;
    try { await db.collection('stores').doc(id).delete(); } catch (e) { err(e); alert('Delete failed'); }
  }
  async function eden_deleteProduct(id) {
    if (!confirm('Delete product?')) return;
    try { await db.collection('products').doc(id).delete(); } catch (e) { err(e); alert('Delete failed'); }
  }
  async function eden_deletePricing(id) {
    if (!confirm('Delete pricing entry?')) return;
    try { await db.collection('pricing').doc(id).delete(); } catch (e) { err(e); alert('Delete failed'); }
  }

  // ----- UI helpers -----
  function showElement(id) { const el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
  function hideElement(id) { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }
  function setText(id, txt) { const el = document.getElementById(id); if (el) el.textContent = txt; }
  function escapeHtml(s) { if (s === null || s === undefined) return ''; return String(s).replace(/[&<>"'`=\/]/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;','=':'&#61;','/':'&#47;'}[c]; }); }

  // ----- Bind UI actions (submit forms etc) -----
  function setupUIActions() {
    // Sale entry form
    const saleForm = document.getElementById('saleForm');
    if (saleForm) {
      saleForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const storeId = document.getElementById('saleStore').value;
        const productId = document.getElementById('saleProduct').value;
        const qty = Number(document.getElementById('quantity')?.textContent || '1') || 1;
        // Determine unit price using pricing override or product basePrice
        let unitPrice = 0;
        // Try to find store-specific price
        const pr = state.pricing.find(pp => pp.storeId === storeId && pp.productId === productId);
        if (pr && pr.storePrice) unitPrice = Number(pr.storePrice);
        else unitPrice = Number(state.products.find(p => p.id === productId)?.basePrice || 0);
        await addSale({ storeId, productId, quantity: qty, unitPrice, recordedBy: currentUser && currentUser.id });
        // reset quantity
        const qEl = document.getElementById('quantity'); if (qEl) qEl.textContent = '1';
      });
    }

    // Quantity buttons
    const inc = document.getElementById('increaseQty');
    const dec = document.getElementById('decreaseQty');
    if (inc) inc.addEventListener('click', () => updateQuantity(1));
    if (dec) dec.addEventListener('click', () => updateQuantity(-1));

    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    // Login form (if not already wired)
    const loginForm = document.getElementById('loginForm');
    if (loginForm && !loginForm.dataset.bound) {
      loginForm.addEventListener('submit', handleLoginFormSubmit);
      loginForm.dataset.bound = '1';
    }

    // Product/store dropdown changes update total
    const saleProduct = document.getElementById('saleProduct');
    if (saleProduct) saleProduct.addEventListener('change', updateTotal);
    const saleStore = document.getElementById('saleStore');
    if (saleStore) saleStore.addEventListener('change', updateTotal);
  }

  function updateQuantity(delta) {
    const el = document.getElementById('quantity');
    if (!el) return;
    let q = Number(el.textContent || '1') || 1;
    q = Math.max(1, q + delta);
    el.textContent = q;
    updateTotal();
  }

  function updateTotal() {
    const productId = document.getElementById('saleProduct')?.value || null;
    const storeId = document.getElementById('saleStore')?.value || null;
    const qty = Number(document.getElementById('quantity')?.textContent || '1') || 1;
    if (!productId) {
      setText('totalAmount', 'Total: $0.00');
      return;
    }
    let unitPrice = Number(state.products.find(p => p.id === productId)?.basePrice || 0);
    const pr = state.pricing.find(pp => pp.storeId === storeId && pp.productId === productId);
    if (pr && pr.storePrice) unitPrice = Number(pr.storePrice);
    setText('totalAmount', `Total: $${(unitPrice * qty).toFixed(2)}`);
  }

  // ----- Logout -----
  async function logout() {
    try {
      // detach listeners
      unsubscribes.forEach(fn => fn && fn());
      unsubscribes.length = 0;
      // sign out (anonymous)
      try { await auth.signOut(); } catch (e) { /* ignore */ }
      currentUser = null;
      isAdmin = false;
      hideElement('mainApp');
      showElement('loginScreen');
      setText('userWelcome', '');
      log('Logged out');
    } catch (e) {
      err('Logout failed', e);
    }
  }

  // ----- Startup wiring -----
  async function startup() {
    const ok = await initFirebase();
    if (!ok) {
      warn('Firebase init failed — the app may still work in demo mode if you use the admin backdoor.');
    }

    // Wire login form if present
    const loginForm = document.getElementById('loginForm');
    if (loginForm && !loginForm.dataset.bound) {
      loginForm.addEventListener('submit', handleLoginFormSubmit);
      loginForm.dataset.bound = '1';
    }

    // Wire other UI actions so admin backdoor works even before snapshots
    setupUIActions();
  }

  // Expose a few functions globally for inline HTML buttons to call (delete actions, addSale wrapper)
  window.eden_addSale = addSale;
  window.eden_deleteEmployee = eden_deleteEmployee;
  window.eden_deleteStore = eden_deleteStore;
  window.eden_deleteProduct = eden_deleteProduct;
  window.eden_deletePricing = eden_deletePricing;

  // Start
  startup();
})();
