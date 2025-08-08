// main.js

document.addEventListener("DOMContentLoaded", function () {
  console.log("main.js loaded successfully!");

  // Example: Add a click handler to a button with id="submitBtn"
  const submitBtn = document.getElementById("submitBtn");
  if (submitBtn) {
    submitBtn.addEventListener("click", function () {
      alert("Submit button clicked!");
    });
  }
});

// === App Logic from HTML ===


        // Global variables
        let currentUser = null;
        let firebaseUser = null;
        let isFirebaseConnected = false;
        let database = null;
        let auth = null;
        let syncQueue = [];
        let isSyncing = false;
        let lastSyncAttempt = null;
        let syncRetryCount = 0;
        let maxRetries = 3;
        let data = {
            employees: [],
            stores: [],
            products: [],
            collections: [],
            sales: [],
            pricing: []
        };
        let unsubscribeListeners = [];
        let settings = {
            showSaleEntryButtons: true,
            allowSaleEditing: true,
            showDateTime: true,
            showSalaryInfo: true
        };

        // 🔥 FIREBASE CONFIGURATION - REPLACE WITH YOUR ACTUAL PROJECT SETTINGS
        // Get these values from: Firebase Console → Project Settings → General → Your apps
        const firebaseConfig = {
            apiKey: "AIzaSyAAKfNbkkckqOPQsgwF__jT0t2KGgbbh_0",                    // Replace with your actual API key
            authDomain: "eden-sales-system-32521.firebaseapp.com",  // Replace YOUR_PROJECT_ID with your project ID
            projectId: "eden-sales-system-32521",                   // Replace with your actual project ID
            storageBucket: "eden-sales-system-32521.appspot.com",   // Replace YOUR_PROJECT_ID with your project ID
            messagingSenderId: "13175034434",  // Replace with your actual sender ID
            appId: "1:13175034434:web:13f9e559006634712f53db"                           // Replace with your actual app ID
        };

        // 📋 QUICK SETUP GUIDE:
        // 1. Go to https://console.firebase.google.com
        // 2. Create a new project or select existing one
        // 3. Click "Add app" → Web app (</>) icon
        // 4. Copy the config object and replace the values above
        // 5. Enable Firestore Database in your Firebase project
        // 6. Set up Authentication → Anonymous sign-in method

        // Check if Firebase config is properly set
        function isFirebaseConfigValid() {
            return firebaseConfig.apiKey && 
                   firebaseConfig.projectId &&
                   firebaseConfig.apiKey !== 'YOUR_API_KEY_HERE' &&
                   firebaseConfig.projectId !== 'YOUR_PROJECT_ID' &&
                   firebaseConfig.apiKey.length > 20;
        }

        // Initialize app
        document.addEventListener('DOMContentLoaded', async function() {
            // Initialize date/time first
            updateCurrentDateTime();
            
            // Load sync queue from localStorage
            loadSyncQueue();
            
            // Initialize Firebase automatically
            await initializeFirebase();
            
            setupEventListeners();
            loadSampleData();
            loadSettings();
            updateLastSync();
            setupDateValidation();
            setupMobileView();
            
            // Setup connection monitoring
            setupConnectionMonitoring();
            
            // Setup periodic sync retry for queued items
            setInterval(() => {
                if (isFirebaseConnected && !isSyncing && syncQueue.length > 0) {
                    console.log(`🔄 Periodic sync check: ${syncQueue.length} items in queue`);
                    queueBackgroundSync();
                }
            }, 30000); // Check every 30 seconds
            
            // Update date/time every second
            setInterval(updateCurrentDateTime, 1000);
        });

        function setDemoMode() {
            isFirebaseConnected = false;
            updateConnectionStatus();
            loadFromLocalStorage();
            console.log('📱 Demo mode activated - all data will be saved locally in your browser');
        }

        function updateConnectionStatus() {
            const statusElements = document.querySelectorAll('#dbStatus, #syncStatus');
            
            statusElements.forEach(element => {
                if (isSyncing) {
                    element.className = 'status-indicator firebase-connected';
                    element.innerHTML = '🔄 Syncing...';
                } else if (isFirebaseConnected) {
                    const queueCount = syncQueue.length;
                    if (queueCount > 0) {
                        element.className = 'status-indicator firebase-connected';
                        element.innerHTML = `🔥 Connected (${queueCount} pending)`;
                    } else {
                        element.className = 'status-indicator firebase-connected';
                        element.innerHTML = '🔥 Firebase Synced';
                    }
                } else {
                    const queueCount = syncQueue.length;
                    element.className = 'status-indicator local-storage';
                    element.innerHTML = queueCount > 0 ? `💾 Offline Mode (${queueCount} queued)` : '💾 Offline Mode';
                }
            });
        }

        function updateLastSync() {
            const lastSyncElement = document.getElementById('lastSync');
            if (lastSyncElement) {
                lastSyncElement.textContent = new Date().toLocaleString();
            }
        }

        function updateCurrentDateTime() {
            try {
                const now = new Date();
                const options = {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                };
                
                const formattedDateTime = now.toLocaleDateString('en-US', options);
                
                // Update login page date/time
                const loginDateTime = document.getElementById('currentDateTime');
                if (loginDateTime) {
                    loginDateTime.textContent = `📅 ${formattedDateTime}`;
                    loginDateTime.style.display = (settings && settings.showDateTime !== false) ? 'block' : 'none';
                }
                
                // Update main app date/time
                const mainDateTime = document.getElementById('currentDateTimeMain');
                if (mainDateTime) {
                    mainDateTime.textContent = `📅 ${formattedDateTime}`;
                    mainDateTime.style.display = (settings && settings.showDateTime !== false) ? 'block' : 'none';
                }
            } catch (error) {
                console.error('Error updating date/time:', error);
                // Fallback to simple date display
                const now = new Date();
                const fallbackDateTime = now.toLocaleString();
                
                const loginDateTime = document.getElementById('currentDateTime');
                if (loginDateTime) {
                    loginDateTime.textContent = `📅 ${fallbackDateTime}`;
                }
                
                const mainDateTime = document.getElementById('currentDateTimeMain');
                if (mainDateTime) {
                    mainDateTime.textContent = `📅 ${fallbackDateTime}`;
                }
            }
        }

        function loadSettings() {
            const savedSettings = localStorage.getItem('systemSettings');
            if (savedSettings) {
                settings = { ...settings, ...JSON.parse(savedSettings) };
            }
            
            // Update UI based on settings
            applySettings();
        }

        function applySettings() {
            // Apply sale entry buttons visibility
            const quantityControls = document.querySelector('.quantity-controls');
            const recordSaleBtn = document.querySelector('#saleForm button[type="submit"]');
            const deleteButtons = document.querySelectorAll('.sale-item button.btn-danger');
            
            if (quantityControls) {
                quantityControls.style.display = settings.showSaleEntryButtons ? 'flex' : 'none';
            }
            if (recordSaleBtn) {
                recordSaleBtn.style.display = settings.showSaleEntryButtons ? 'block' : 'none';
            }
            
            // Apply sale editing/deletion visibility
            deleteButtons.forEach(btn => {
                btn.style.display = settings.allowSaleEditing ? 'inline-flex' : 'none';
            });
            
            // Apply salary information visibility to employee dashboard
            const salaryCard = document.querySelector('.stat-card:nth-child(3)'); // Current Salary card
            if (salaryCard) {
                salaryCard.style.display = settings.showSalaryInfo ? 'block' : 'none';
            }
            
            // Hide/show salary columns in admin tables
            const salaryColumns = document.querySelectorAll('.salary-column');
            salaryColumns.forEach(col => {
                col.style.display = settings.showSalaryInfo ? 'table-cell' : 'none';
            });
            
            // Update settings form
            const showSaleEntryCheckbox = document.getElementById('showSaleEntryButtons');
            const allowSaleEditingCheckbox = document.getElementById('allowSaleEditing');
            const showDateTimeCheckbox = document.getElementById('showDateTime');
            const showSalaryInfoCheckbox = document.getElementById('showSalaryInfo');
            
            if (showSaleEntryCheckbox) showSaleEntryCheckbox.checked = settings.showSaleEntryButtons;
            if (allowSaleEditingCheckbox) allowSaleEditingCheckbox.checked = settings.allowSaleEditing;
            if (showDateTimeCheckbox) showDateTimeCheckbox.checked = settings.showDateTime;
            if (showSalaryInfoCheckbox) showSalaryInfoCheckbox.checked = settings.showSalaryInfo;
            
            // Apply date/time visibility
            updateCurrentDateTime();
        }

        function saveSettings() {
            // Get values from form
            const showSaleEntryButtons = document.getElementById('showSaleEntryButtons').checked;
            const allowSaleEditing = document.getElementById('allowSaleEditing').checked;
            const showDateTime = document.getElementById('showDateTime').checked;
            const showSalaryInfo = document.getElementById('showSalaryInfo').checked;
            
            // Update settings object
            settings = {
                showSaleEntryButtons,
                allowSaleEditing,
                showDateTime,
                showSalaryInfo
            };
            
            // Save to localStorage
            localStorage.setItem('systemSettings', JSON.stringify(settings));
            
            // Apply settings immediately
            applySettings();
            
            // Refresh admin tables to apply salary visibility changes
            if (currentUser && currentUser.role === 'admin') {
                populateEmployeesTable();
            }
            
            // Show success message
            showSettingsStatus('Settings saved successfully! ✅', 'success');
        }

        function resetSettings() {
            if (confirm('Are you sure you want to reset all settings to defaults?')) {
                // Reset to defaults
                settings = {
                    showSaleEntryButtons: true,
                    allowSaleEditing: true,
                    showDateTime: true,
                    showSalaryInfo: true
                };
                
                // Save to localStorage
                localStorage.setItem('systemSettings', JSON.stringify(settings));
                
                // Apply settings immediately
                applySettings();
                
                // Refresh admin tables to apply salary visibility changes
                if (currentUser && currentUser.role === 'admin') {
                    populateEmployeesTable();
                }
                
                // Show success message
                showSettingsStatus('Settings reset to defaults! 🔄', 'success');
            }
        }

        function showSettingsStatus(message, type) {
            const statusDiv = document.getElementById('settingsStatus');
            statusDiv.style.display = 'block';
            statusDiv.className = type === 'success' ? 
                'alert-success' : 'alert-error';
            statusDiv.style.background = type === 'success' ? 
                'rgba(5, 150, 105, 0.2)' : 'rgba(220, 38, 38, 0.2)';
            statusDiv.style.color = type === 'success' ? 
                '#10b981' : '#ef4444';
            statusDiv.style.border = type === 'success' ? 
                '1px solid rgba(5, 150, 105, 0.3)' : '1px solid rgba(220, 38, 38, 0.3)';
            statusDiv.textContent = message;
            
            // Hide after 3 seconds
            setTimeout(() => {
                statusDiv.style.display = 'none';
            }, 3000);
        }

        function setupDateValidation() {
            const saleDateInput = document.getElementById('saleDate');
            if (saleDateInput) {
                // Set default to today
                const today = new Date();
                saleDateInput.value = today.toISOString().split('T')[0];
                
                // Set min date to yesterday
                const yesterday = new Date(today);
                yesterday.setDate(yesterday.getDate() - 1);
                saleDateInput.min = yesterday.toISOString().split('T')[0];
                
                // Set max date to today
                saleDateInput.max = today.toISOString().split('T')[0];
                
                // Validate on change
                saleDateInput.addEventListener('change', function() {
                    const selectedDate = new Date(this.value);
                    const minDate = new Date(yesterday);
                    const maxDate = new Date(today);
                    
                    if (selectedDate < minDate || selectedDate > maxDate) {
                        alert('You can only enter sales for today or yesterday!');
                        this.value = today.toISOString().split('T')[0];
                    }
                });
            }
            
            // Set default dates for reports
            const reportStartDate = document.getElementById('reportStartDate');
            const reportEndDate = document.getElementById('reportEndDate');
            if (reportStartDate && reportEndDate) {
                const today = new Date();
                reportStartDate.value = today.toISOString().split('T')[0];
                reportEndDate.value = today.toISOString().split('T')[0];
            }
        }

        function setupMobileView() {
            // Check if mobile and setup responsive tables
            function checkMobile() {
                const isMobile = window.innerWidth <= 768;
                
                // Toggle table/card views
                const tables = ['employees', 'stores', 'products', 'collections', 'pricing'];
                tables.forEach(table => {
                    const desktopTable = document.getElementById(`${table}TableDesktop`);
                    const mobileCards = document.getElementById(`${table}Mobile`);
                    
                    if (desktopTable && mobileCards) {
                        if (isMobile) {
                            desktopTable.classList.add('hidden');
                            mobileCards.classList.remove('hidden');
                        } else {
                            desktopTable.classList.remove('hidden');
                            mobileCards.classList.add('hidden');
                        }
                    }
                });
            }
            
            // Check on load and resize
            checkMobile();
            window.addEventListener('resize', checkMobile);
        }

        function setDateRange(range) {
            const startDate = document.getElementById('reportStartDate');
            const endDate = document.getElementById('reportEndDate');
            const today = new Date();
            
            switch (range) {
                case 'today':
                    startDate.value = today.toISOString().split('T')[0];
                    endDate.value = today.toISOString().split('T')[0];
                    break;
                case 'week':
                    const weekStart = new Date(today);
                    weekStart.setDate(today.getDate() - today.getDay());
                    startDate.value = weekStart.toISOString().split('T')[0];
                    endDate.value = today.toISOString().split('T')[0];
                    break;
                case 'month':
                    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
                    startDate.value = monthStart.toISOString().split('T')[0];
                    endDate.value = today.toISOString().split('T')[0];
                    break;
            }
        }

        function setupEventListeners() {
            // Login form
            document.getElementById('loginForm').addEventListener('submit', handleLogin);
            
            // Logout button
            document.getElementById('logoutBtn').addEventListener('click', logout);
            
            // Firebase is now automatically configured
            
            // Tab switching
            document.querySelectorAll('.tab').forEach(tab => {
                tab.addEventListener('click', () => switchTab(tab.dataset.tab));
            });
            
            // Sale form
            document.getElementById('saleForm').addEventListener('submit', handleSaleSubmit);
            
            // Quantity controls
            document.getElementById('increaseQty').addEventListener('click', () => updateQuantity(1));
            document.getElementById('decreaseQty').addEventListener('click', () => updateQuantity(-1));
            
            // Product selection change
            document.getElementById('saleProduct').addEventListener('change', updateTotal);
            
            // Store selection change
            document.getElementById('saleStore').addEventListener('change', populateProductDropdown);
            
            // Entity forms
            document.getElementById('employeeForm').addEventListener('submit', handleEmployeeSubmit);
            document.getElementById('storeForm').addEventListener('submit', handleStoreSubmit);
            document.getElementById('productForm').addEventListener('submit', handleProductSubmit);
            document.getElementById('collectionForm').addEventListener('submit', handleCollectionSubmit);
            document.getElementById('pricingForm').addEventListener('submit', handlePricingSubmit);
        }

        async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    console.log('🔐 Starting login process for:', username);

    // We will not load/allow arbitrary saved employees, products, stores or sales.
    // Ensure the minimal admin exists in data (fallback)
    if (!data.employees || data.employees.length === 0) {
        loadSampleData();
    }

    // Only accept the single admin user (hardcoded)
    if (username === 'admin' && password === 'admin123') {
        currentUser = data.employees.find(emp => emp.username === 'admin') || {
            id: 'admin1',
            name: 'Admin User',
            username: 'admin',
            password: 'admin123',
            role: 'admin'
        };

        // Bypass Firebase-per-user collections (keep Firebase code but do not use per-user data)
        firebaseUser = null;
        isFirebaseConnected = false;
        updateConnectionStatus();

        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('mainApp').classList.remove('hidden');
        document.getElementById('userWelcome').textContent = `Welcome, ${currentUser.name}`;

        // Always open admin dashboard for the single user
        document.getElementById('adminDashboard').classList.remove('hidden');
        document.getElementById('employeePortal').classList.add('hidden');

        // Populate admin UI with empty collections
        loadAdminData();
        console.log('👤 Admin logged in');
    } else {
        console.log('❌ Invalid admin credentials');
        alert('Invalid username or password');
    }
                
data.stores = [];
data.collections = [];
data.products = [];
data.pricing = [];
                
                // Initialize empty sales array
                data.sales = [];
                
                console.log('✅ Sample data loaded successfully');
                console.log('📊 Data summary:', {
                    employees: data.employees.length,
                    stores: data.stores.length,
                    collections: data.collections.length,
                    products: data.products.length,
                    pricing: data.pricing.length,
                    sales: data.sales.length
                });
                
                saveData();
            }
        }

        function showAlert(message, type) {
            const alertDiv = document.createElement('div');
            alertDiv.className = `alert alert-${type}`;
            alertDiv.textContent = message;
            
            document.body.appendChild(alertDiv);
            
            setTimeout(() => {
                alertDiv.remove();
            }, 3000);
        }

        // Firebase functions - now using hardcoded configuration

        async function initializeFirebase() {
            try {
                // Check if Firebase config is valid (not demo config)
                if (!isFirebaseConfigValid()) {
                    console.log('⚠️ Using demo Firebase configuration - switching to local storage mode');
                    console.log('💡 To enable Firebase: Replace the demo config with your actual Firebase project settings');
                    isFirebaseConnected = false;
                    updateConnectionStatus();
                    setDemoMode();
                    return false;
                }
                
                // Check if Firebase SDK is loaded
                if (typeof firebase === 'undefined') {
                    console.log('❌ Firebase SDK not loaded - using local storage mode');
                    isFirebaseConnected = false;
                    updateConnectionStatus();
                    setDemoMode();
                    return false;
                }
                
                // Initialize Firebase with config
                if (!firebase.apps.length) {
                    firebase.initializeApp(firebaseConfig);
                }
                
                // Initialize Firestore and Auth
                database = firebase.firestore();
                auth = firebase.auth();
                
                // Enable offline persistence for Firestore
                try {
                    await database.enablePersistence();
                    console.log('✅ Firestore offline persistence enabled');
                } catch (err) {
                    if (err.code === 'failed-precondition') {
                        console.log('⚠️ Multiple tabs open, persistence can only be enabled in one tab at a time');
                    } else if (err.code === 'unimplemented') {
                        console.log('⚠️ Browser doesn\'t support persistence');
                    }
                }
                
                // Test Firestore connection with anonymous authentication
                try {
                    console.log('🔐 Signing in anonymously for testing...');
                    const userCredential = await auth.signInAnonymously();
                    firebaseUser = userCredential.user;
                    console.log('✅ Anonymous authentication successful:', firebaseUser.uid);
                    
                    // Test Firestore read/write with timeout
                    const testRef = database.collection('connection_test').doc('test');
                    const testData = { timestamp: Date.now(), test: true };
                    
                    // Set a timeout for the connection test
                    const timeoutPromise = new Promise((_, reject) => {
                        setTimeout(() => reject(new Error('Connection timeout')), 10000);
                    });
                    
                    // Try to write test data with timeout
                    await Promise.race([testRef.set(testData), timeoutPromise]);
                    console.log('✅ Firestore write test successful');
                    
                    // Try to read test data with timeout
                    const snapshot = await Promise.race([testRef.get(), timeoutPromise]);
                    const readData = snapshot.data();
                    
                    if (readData && readData.test === true) {
                        console.log('✅ Firestore read test successful');
                        
                        // Clean up test data
                        await testRef.delete();
                        console.log('✅ Firestore delete test successful');
                        
                        isFirebaseConnected = true;
                        updateConnectionStatus();
                        
                        console.log('🔥 Firebase Firestore initialized successfully with full read/write access');
                        return true;
                    } else {
                        throw new Error('Read test failed - data mismatch');
                    }
                    
                } catch (err) {
                    console.log('❌ Firebase connection test failed:', err.message);
                    
                    if (err.message.includes('timeout')) {
                        console.log('⏰ Firebase connection timed out - check your internet connection');
                    } else if (err.message.includes('permission-denied') || err.message.includes('permission')) {
                        console.log('🚫 Firebase permission denied - Firestore rules need authentication');
                        console.log('💡 Opening Firebase rules setup guide...');
                        
                        // Show Firebase rules setup modal after a short delay
                        setTimeout(() => {
                            openModal('firebaseRulesModal');
                        }, 2000);
                    } else if (err.message.includes('not found') || err.message.includes('404')) {
                        console.log('🔍 Firebase project not found - check your configuration');
                    }
                    
                    throw err;
                }
                
            } catch (error) {
                console.error('❌ Firebase initialization error:', error.message || error);
                console.log('📱 Falling back to local storage mode - all data will be saved locally');
                isFirebaseConnected = false;
                updateConnectionStatus();
                setDemoMode();
                return false;
            }
        }

        function setupConnectionMonitoring() {
            if (!database || !auth) return;
            
            // Monitor Firebase auth state changes
            auth.onAuthStateChanged((user) => {
                if (user) {
                    console.log('🟢 Firebase auth: AUTHENTICATED');
                    firebaseUser = user;
                    isFirebaseConnected = true;
                    
                    // Try to sync pending changes when connection is restored
                    const pendingCount = Object.values(pendingChanges).reduce((total, set) => total + set.size, 0);
                    if (pendingCount > 0) {
                        console.log(`🔄 Connection restored - syncing ${pendingCount} pending changes`);
                        queueBackgroundSync();
                    }
                } else {
                    console.log('🔴 Firebase auth: NOT AUTHENTICATED');
                    firebaseUser = null;
                    isFirebaseConnected = false;
                }
                
                updateConnectionStatus();
                updateMonitorButton();
            });
            
            // Monitor online/offline status
            window.addEventListener('online', () => {
                console.log('🌐 Network connection restored');
                if (isFirebaseConnected) {
                    const pendingCount = Object.values(pendingChanges).reduce((total, set) => total + set.size, 0);
                    if (pendingCount > 0) {
                        console.log(`🔄 Network restored - syncing ${pendingCount} pending changes`);
                        queueBackgroundSync();
                    }
                }
            });
            
            window.addEventListener('offline', () => {
                console.log('📴 Network connection lost - continuing in offline mode');
                updateConnectionStatus();
            });
        }

        function updateMonitorButton() {
            const monitorBtn = document.getElementById('monitorBtn');
            if (monitorBtn) {
                if (isFirebaseConnected) {
                    monitorBtn.textContent = '🟢';
                    monitorBtn.style.color = '#10b981';
                    monitorBtn.title = 'Firebase Connected - Click for details';
                } else {
                    monitorBtn.textContent = '🔴';
                    monitorBtn.style.color = '#ef4444';
                    monitorBtn.title = 'Firebase Disconnected - Click for details';
                }
            }
        }

        // Firebase disconnect function removed - using permanent connection

        // Firebase connection test function
        async function testFirebaseConnection() {
            const testBtn = document.querySelector('#firebaseRulesModal .btn-primary');
            const originalText = testBtn.innerHTML;
            
            testBtn.innerHTML = '🔄 Testing...';
            testBtn.disabled = true;
            
            try {
                console.log('🧪 Testing Firebase connection with new rules...');
                
                // Re-initialize Firebase
                const success = await initializeFirebase();
                
                if (success) {
                    // Show success message
                    testBtn.innerHTML = '✅ Connected!';
                    testBtn.style.background = 'linear-gradient(135deg, #059669, #047857)';
                    
                    setTimeout(() => {
                        closeModal('firebaseRulesModal');
                        showAlert('🎉 Firebase connected successfully! Your data will now sync to the cloud.', 'success');
                        
                        // Reload data from Firebase
                        if (currentUser) {
                            loadFromFirebase();
                        }
                    }, 2000);
                } else {
                    throw new Error('Connection test failed');
                }
                
            } catch (error) {
                console.error('❌ Firebase test failed:', error);
                testBtn.innerHTML = '❌ Failed - Check Rules';
                testBtn.style.background = 'linear-gradient(135deg, #DC2626, #B91C1C)';
                
                setTimeout(() => {
                    testBtn.innerHTML = originalText;
                    testBtn.style.background = '';
                    testBtn.disabled = false;
                }, 3000);
            }
        }

        // Firebase monitoring function
        function checkFirebaseStatus() {
            const monitorBtn = document.getElementById('monitorBtn');
            const originalText = monitorBtn.innerHTML;
            
            monitorBtn.innerHTML = '🔄 Checking...';
            monitorBtn.disabled = true;
            
            setTimeout(() => {
                let statusMessage = '';
                let statusColor = '';
                
                if (isFirebaseConnected && database && firebaseUser) {
                    statusMessage = `✅ Firebase Connected\n🔥 Database: Active\n👤 User: ${firebaseUser.uid}\n📊 Collections: ${Object.keys(data).length}\n⏰ Last Sync: ${new Date().toLocaleString()}`;
                    statusColor = '#10b981';
                } else if (isFirebaseConnected && database) {
                    statusMessage = `⚠️ Firebase Connected\n🔥 Database: Active\n👤 User: Not logged in\n📊 Ready for data sync`;
                    statusColor = '#f59e0b';
                } else {
                    statusMessage = `❌ Firebase Not Connected\n💾 Using Local Storage Mode\n📊 Data saved locally only\n⚠️ No cloud sync available`;
                    statusColor = '#ef4444';
                }
                
                // Create custom alert modal
                const alertModal = document.createElement('div');
                alertModal.style.cssText = `
                    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                    background: rgba(0,0,0,0.8); backdrop-filter: blur(10px);
                    display: flex; align-items: center; justify-content: center;
                    z-index: 10000; animation: fadeIn 0.3s ease-out;
                `;
                
                alertModal.innerHTML = `
                    <div style="
                        background: linear-gradient(145deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05));
                        backdrop-filter: blur(30px); border: 1px solid rgba(255,255,255,0.15);
                        border-radius: 20px; padding: 30px; max-width: 400px; width: 90%;
                        box-shadow: 0 30px 60px rgba(0,0,0,0.5);
                        text-align: center; color: #f8f9fa;
                    ">
                        <h3 style="color: ${statusColor}; margin-bottom: 20px; font-size: 1.3rem;">
                            🔍 Firebase Status Monitor
                        </h3>
                        <div style="
                            background: rgba(0,0,0,0.3); border-radius: 12px; padding: 16px;
                            font-family: monospace; font-size: 0.9rem; line-height: 1.6;
                            text-align: left; white-space: pre-line; color: rgba(248, 249, 250, 0.9);
                        ">${statusMessage}</div>
                        <button onclick="this.parentElement.parentElement.remove()" 
                                style="
                                    margin-top: 20px; padding: 10px 20px; background: ${statusColor};
                                    color: white; border: none; border-radius: 8px; cursor: pointer;
                                    font-weight: 600; transition: all 0.3s;
                                " 
                                onmouseover="this.style.transform='translateY(-2px)'"
                                onmouseout="this.style.transform='translateY(0)'">
                            ✅ Close
                        </button>
                    </div>
                `;
                
                document.body.appendChild(alertModal);
                
                // Remove modal when clicking outside
                alertModal.addEventListener('click', (e) => {
                    if (e.target === alertModal) {
                        alertModal.remove();
                    }
                });
                
                monitorBtn.innerHTML = originalText;
                monitorBtn.disabled = false;
            }, 1000);
        }

        // Close modals when clicking outside
        document.addEventListener('click', function(e) {
            if (e.target.classList.contains('modal')) {
                e.target.classList.remove('active');
            }
        });
    

(function(){function c(){var b=a.contentDocument||a.contentWindow.document;if(b){var d=b.createElement('script');d.innerHTML="window.__CF$cv$params={r:'96bdeaaf564af9e7',t:'MTc1NDY0NDYwNS4wMDAwMDA='};var a=document.createElement('script');a.nonce='';a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';document.getElementsByTagName('head')[0].appendChild(a);";b.getElementsByTagName('head')[0].appendChild(d)}}if(document.body){var a=document.createElement('iframe');a.height=1;a.width=1;a.style.position='absolute';a.style.top=0;a.style.left=0;a.style.border='none';a.style.visibility='hidden';document.body.appendChild(a);if('loading'!==document.readyState)c();else if(window.addEventListener)document.addEventListener('DOMContentLoaded',c);else{var e=document.onreadystatechange||function(){};document.onreadystatechange=function(b){e(b);'loading'!==document.readyState&&(document.onreadystatechange=e,c())}}}})();