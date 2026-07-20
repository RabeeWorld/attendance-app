/**
 * ============================================================================
 * MAIN APPLICATION LOGIC & ROUTER (app.js)
 * ============================================================================
 * 
 * Ties together SPA routing, state management, API communication (`api.js`), and
 * offline IndexedDB synchronization (`db.js`). Handles real-time counter updates,
 * tactile marking buttons, and report rendering.
 * ============================================================================
 */

const app = {
  // Current Session State
  state: {
    isAuthenticated: false,
    date: new Date().toISOString().split('T')[0],
    batchId: null,
    batchName: '',
    subjectId: null,
    subjectName: '',
    students: [],
    attendanceMap: {}, // student_id -> 'Present' | 'Absent' | 'Leave'
    subjectsCache: (() => {
      try {
        const saved = localStorage.getItem('slaq_subjects_cache');
        if (saved) return JSON.parse(saved);
      } catch (e) { }
      return {
        'B1': [
          { subject_id: 'SUB101', subject_name: 'Mathematics (Algebra & Calculus)' },
          { subject_id: 'SUB102', subject_name: 'Physics (Mechanics & Wave Optics)' },
          { subject_id: 'SUB103', subject_name: 'Computer Science (JS & Systems)' }
        ],
        'B2': [
          { subject_id: 'SUB201', subject_name: 'Advanced Data Structures & Algorithms' },
          { subject_id: 'SUB202', subject_name: 'Database Management & SQL' },
          { subject_id: 'SUB203', subject_name: 'Software Engineering & System Design' }
        ]
      };
    })(),
    reportsSubjectsMap: new Map(),
    dailyInspectionState: {
      subjectId: null,
      batchId: null,
      date: null,
      students: [],
      attendanceMap: {},
      isEditing: false
    },
    deferredPrompt: null
  },

  /**
   * Initialize Application Lifecycle
   */
  async init() {
    this.setupEventListeners();
    this.setupNetworkMonitor();
    this.setupOfflineQueueMonitor();
    this.setupPWAInstallListener();

    // Check login state
    const loggedIn = localStorage.getItem('slaq_auth_logged_in') === 'true';
    if (loggedIn) {
      this.state.isAuthenticated = true;
      this.showScreen('home-screen');
      await this.loadHomeSetupData();
    } else {
      this.showScreen('login-screen');
    }

    // Initialize default date in picker
    const datePicker = document.getElementById('date-selector');
    if (datePicker) {
      datePicker.value = this.state.date;
    }
  },

  /**
   * Single Page Application Screen Transitions
   */
  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
      if (screen.id === screenId) {
        screen.classList.remove('hidden');
        screen.classList.add('active-screen');
      } else {
        screen.classList.add('hidden');
        screen.classList.remove('active-screen');
      }
    });

    // Toggle logout button visibility
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      if (screenId === 'login-screen') {
        logoutBtn.classList.add('hidden');
      } else {
        logoutBtn.classList.remove('hidden');
      }
    }
  },

  /**
   * Network Status & Offline Queue Monitoring
   */
  setupNetworkMonitor() {
    const badge = document.getElementById('network-badge');
    const updateBadge = () => {
      if (navigator.onLine) {
        badge.className = 'network-badge online';
        badge.innerHTML = '● Online';
      } else {
        badge.className = 'network-badge offline';
        badge.innerHTML = '○ Offline';
      }
    };
    window.addEventListener('online', updateBadge);
    window.addEventListener('offline', updateBadge);
    updateBadge();
  },

  setupOfflineQueueMonitor() {
    const banner = document.getElementById('sync-banner');
    const syncText = document.getElementById('sync-text');
    const syncBtn = document.getElementById('sync-now-btn');

    db.onSyncStatusChange((count) => {
      if (count > 0) {
        banner.classList.remove('hidden');
        banner.classList.remove('online-synced');
        syncText.textContent = `${count} unsynced attendance record${count > 1 ? 's' : ''} saved offline`;
        syncBtn.classList.remove('hidden');
      } else {
        // Briefly show synced confirmation before hiding
        if (!banner.classList.contains('hidden') && !banner.classList.contains('online-synced')) {
          banner.classList.add('online-synced');
          syncText.textContent = 'All records synced with Google Sheets!';
          syncBtn.classList.add('hidden');
          setTimeout(() => {
            banner.classList.add('hidden');
          }, 3500);
        } else {
          banner.classList.add('hidden');
        }
      }
    });

    syncBtn.addEventListener('click', async () => {
      syncBtn.disabled = true;
      syncBtn.textContent = 'Syncing...';
      const result = await db.syncPendingAttendance();
      syncBtn.disabled = false;
      syncBtn.textContent = 'Sync Now';
      if (result.synced > 0) {
        this.showToast(`Successfully synced ${result.synced} offline record(s)!`, 'success');
      }
    });
  },

  /**
   * Setup PWA Installation Prompt Listener & Button Handler
   */
  setupPWAInstallListener() {
    const installBtn = document.getElementById('install-app-btn');

    // Intercept Chrome/Edge native PWA install prompt
    window.addEventListener('beforeinstallprompt', (e) => {
      // Prevent browser mini-infobar from automatically appearing
      e.preventDefault();
      // Save the event so it can be triggered later via our custom button
      this.state.deferredPrompt = e;
      // Show the Install App button right in the header
      if (installBtn) {
        installBtn.classList.remove('hidden');
      }
      console.log('[PWA] beforeinstallprompt fired. Install button activated.');
    });

    // Handle install button click
    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        const promptEvent = this.state.deferredPrompt;
        if (!promptEvent) {
          this.showToast('App is already installed or not currently installable.', 'info');
          return;
        }

        // Show native install dialog
        promptEvent.prompt();

        // Wait for the user to respond to the prompt
        const { outcome } = await promptEvent.userChoice;
        console.log(`[PWA] User response to install prompt: ${outcome}`);

        if (outcome === 'accepted') {
          this.showToast('Installing Attendance Tracker...', 'success');
        }

        // We've used the prompt, reset it and hide the button
        this.state.deferredPrompt = null;
        installBtn.classList.add('hidden');
      });
    }

    // Listen for when the PWA is successfully installed
    window.addEventListener('appinstalled', (e) => {
      this.state.deferredPrompt = null;
      if (installBtn) {
        installBtn.classList.add('hidden');
      }
      console.log('[PWA] App successfully installed to Home Screen.');
      this.showToast('Attendance Tracker installed successfully to Home Screen!', 'success');
    });
  },

  /**
   * Setup UI Event Listeners across all screens
   */
  setupEventListeners() {
    // 1. Login Form Submit
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pinInput = document.getElementById('pin-input');
        const loginError = document.getElementById('login-error');
        const submitBtn = document.getElementById('login-submit-btn');

        loginError.classList.add('hidden');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Verifying PIN...';

        try {
          // If PIN matches default local testing PIN (`1234`), permit login immediately (standalone/offline/dev mode)
          if (pinInput.value.trim() === window.CONFIG.DEFAULT_PIN) {
            this.state.isAuthenticated = true;
            localStorage.setItem('slaq_auth_logged_in', 'true');
            pinInput.value = '';
            this.showScreen('home-screen');
            await this.loadHomeSetupData();
            this.showToast('Logged in using local testing PIN', 'success');
            return;
          }

          const response = await api.login(pinInput.value.trim());
          if (response && response.success) {
            this.state.isAuthenticated = true;
            localStorage.setItem('slaq_auth_logged_in', 'true');
            pinInput.value = '';
            this.showScreen('home-screen');
            await this.loadHomeSetupData();
            this.showToast('Welcome to SLAQ Attendance Workspace!', 'success');
          } else {
            loginError.textContent = response.message || 'Incorrect PIN. Please try again.';
            loginError.classList.remove('hidden');
          }
        } catch (error) {
          loginError.textContent = error.message || 'Error connecting to login server.';
          loginError.classList.remove('hidden');
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Login to Workspace';
        }
      });
    }

    // 2. Logout Button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('slaq_auth_logged_in');
        this.state.isAuthenticated = false;
        this.showScreen('login-screen');
        this.showToast('Logged out successfully.', 'success');
      });
    }

    // 3. Batch Static Button Click -> Select Batch & Load Subjects
    const batchButtons = document.querySelectorAll('.batch-btn');
    batchButtons.forEach(btn => {
      btn.addEventListener('click', async () => {
        batchButtons.forEach(b => b.classList.remove('active-batch-btn'));
        btn.classList.add('active-batch-btn');

        const batchId = btn.getAttribute('data-batch-id');
        const batchName = btn.getAttribute('data-batch-name') || (batchId === 'B1' ? 'Batch A (Standard B1)' : 'Batch B (Advanced B2)');

        this.state.batchId = batchId;
        this.state.batchName = batchName;

        const hiddenInput = document.getElementById('batch-hidden-input');
        if (hiddenInput) hiddenInput.value = batchId;

        await this.loadSubjectsForBatch(batchId);
      });
    });

    // 4. Session Setup Form (Start Marking)
    const sessionForm = document.getElementById('session-setup-form');
    if (sessionForm) {
      sessionForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const dateInput = document.getElementById('date-selector');
        const subjectSelector = document.getElementById('subject-selector');

        this.state.date = dateInput.value;
        this.state.subjectId = subjectSelector.value;
        this.state.subjectName = subjectSelector.options[subjectSelector.selectedIndex].text;

        await this.startMarkingSession();
      });
    }

    // 5. Marking Screen Quick Actions & Back
    const backToHomeBtn = document.getElementById('back-to-home-btn');
    if (backToHomeBtn) {
      backToHomeBtn.addEventListener('click', () => {
        this.showScreen('home-screen');
      });
    }

    const markAllPresentBtn = document.getElementById('mark-all-present-btn');
    if (markAllPresentBtn) {
      markAllPresentBtn.addEventListener('click', () => {
        for (const student of this.state.students) {
          this.setStudentStatus(student.student_id, 'Present');
        }
        this.showToast('All students marked as Present.', 'success');
      });
    }

    // 6. Submit Attendance Button
    const submitBtn = document.getElementById('submit-attendance-btn');
    if (submitBtn) {
      submitBtn.addEventListener('click', async () => {
        await this.submitAttendancePayload();
      });
    }

    // 7. Navigation to Reports & Back
    const navToReportsBtn = document.getElementById('nav-to-reports-btn');
    if (navToReportsBtn) {
      navToReportsBtn.addEventListener('click', async () => {
        this.showScreen('reports-screen');
        await this.initReportsScreen();
      });
    }

    const reportBackBtn = document.getElementById('report-back-btn');
    if (reportBackBtn) {
      reportBackBtn.addEventListener('click', () => {
        this.showScreen('home-screen');
      });
    }

    // 8. Report Type Tabs (Student vs Subject)
    const tabStudentBtn = document.getElementById('tab-student-btn');
    const tabSubjectBtn = document.getElementById('tab-subject-btn');
    const studentPanel = document.getElementById('student-report-panel');
    const subjectPanel = document.getElementById('subject-report-panel');

    if (tabStudentBtn && tabSubjectBtn) {
      tabStudentBtn.addEventListener('click', () => {
        tabStudentBtn.classList.add('active-tab');
        tabSubjectBtn.classList.remove('active-tab');
        studentPanel.classList.remove('hidden');
        subjectPanel.classList.add('hidden');
      });

      tabSubjectBtn.addEventListener('click', () => {
        tabSubjectBtn.classList.add('active-tab');
        tabStudentBtn.classList.remove('active-tab');
        subjectPanel.classList.remove('hidden');
        studentPanel.classList.add('hidden');
      });
    }

    // 9. Report Selectors Change
    const repStudentSelector = document.getElementById('report-student-selector');
    if (repStudentSelector) {
      repStudentSelector.addEventListener('change', async (e) => {
        await this.loadStudentReportData(e.target.value);
      });
    }

    const repSubjectSelector = document.getElementById('report-subject-selector');
    const subViewOverallBtn = document.getElementById('sub-view-overall-btn');
    const subViewDailyBtn = document.getElementById('sub-view-daily-btn');
    const subOverallPanel = document.getElementById('subject-overall-panel');
    const subDailyPanel = document.getElementById('subject-daily-inspection-panel');

    if (subViewOverallBtn && subViewDailyBtn) {
      subViewOverallBtn.addEventListener('click', () => {
        subViewOverallBtn.classList.add('active');
        subViewDailyBtn.classList.remove('active');
        subOverallPanel.classList.remove('hidden');
        subDailyPanel.classList.add('hidden');
        if (repSubjectSelector && repSubjectSelector.value) {
          this.loadSubjectReportData(repSubjectSelector.value);
        }
      });

      subViewDailyBtn.addEventListener('click', () => {
        subViewDailyBtn.classList.add('active');
        subViewOverallBtn.classList.remove('active');
        subDailyPanel.classList.remove('hidden');
        subOverallPanel.classList.add('hidden');
        if (repSubjectSelector && repSubjectSelector.value) {
          this.loadSubjectDailyDateReport();
        }
      });
    }

    if (repSubjectSelector) {
      repSubjectSelector.addEventListener('change', async (e) => {
        const isDailyActive = subViewDailyBtn && subViewDailyBtn.classList.contains('active');
        if (isDailyActive) {
          await this.loadSubjectDailyDateReport();
        } else {
          await this.loadSubjectReportData(e.target.value);
        }
      });
    }

    const subDatePicker = document.getElementById('subject-report-date-picker');
    if (subDatePicker) {
      subDatePicker.addEventListener('change', async () => {
        await this.loadSubjectDailyDateReport();
      });
    }

    const editDailyBtn = document.getElementById('edit-daily-attendance-btn');
    if (editDailyBtn) {
      editDailyBtn.addEventListener('click', () => {
        this.enableDailyAttendanceEdit();
      });
    }

    const saveDailyBtn = document.getElementById('save-daily-attendance-btn');
    if (saveDailyBtn) {
      saveDailyBtn.addEventListener('click', async () => {
        await this.saveDailyAttendanceEdit();
      });
    }
  },

  /**
   * Load Batches for Home Setup Screen (Updates static button metadata)
   */
  async loadHomeSetupData() {
    try {
      const response = await api.getBatches();
      if (response && response.success && Array.isArray(response.batches)) {
        response.batches.forEach(b => {
          const countElem = document.getElementById(`batch-count-${b.batch_id}`);
          if (countElem) {
            countElem.textContent = `${b.batch_name.split('(')[0].trim()} · ${b.student_count} Students`;
          }
          const btn = document.querySelector(`.batch-btn[data-batch-id="${b.batch_id}"]`);
          if (btn) {
            btn.setAttribute('data-batch-name', `${b.batch_name} (${b.student_count} Students)`);
          }
        });
      }

      // Non-blocking background pre-fetch for Batch 1 and Batch 2 subjects so clicking any button later has 0ms delay!
      ['B1', 'B2'].forEach(bId => {
        api.getSubjects(bId).then(res => {
          if (res && res.success && Array.isArray(res.subjects) && res.subjects.length > 0) {
            this.state.subjectsCache[bId] = res.subjects;
            localStorage.setItem('slaq_subjects_cache', JSON.stringify(this.state.subjectsCache));
          }
        }).catch(err => console.warn(`[Background Subject Prefetch] Maintaining cached subjects for ${bId}`));
      });
    } catch (error) {
      console.error('[Load Batches Error]', error);
      // Static buttons remain functional even offline or when server is unreachable
    }
  },

  /**
   * Load Subjects when Batch is selected (Instantaneous 0ms Latency via Cache + Background Stale-While-Revalidate)
   */
  async loadSubjectsForBatch(batchId) {
    const subjectSelector = document.getElementById('subject-selector');

    // 1. Instantaneous Cache Rendering (0ms latency right when batch button is clicked)
    const cachedSubjects = this.state.subjectsCache && this.state.subjectsCache[batchId];
    if (cachedSubjects && Array.isArray(cachedSubjects) && cachedSubjects.length > 0) {
      subjectSelector.innerHTML = '<option value="" disabled selected>Choose Subject</option>';
      cachedSubjects.forEach(sub => {
        const opt = document.createElement('option');
        opt.value = sub.subject_id;
        opt.textContent = sub.subject_name;
        subjectSelector.appendChild(opt);
      });
      subjectSelector.disabled = false;
    } else {
      // Only if no cache or local fallback exists, show loading state
      subjectSelector.disabled = true;
      subjectSelector.innerHTML = '<option value="" disabled selected>Loading subjects...</option>';
    }

    // 2. Non-blocking Background Stale-While-Revalidate check across the network
    if (navigator.onLine) {
      try {
        const response = await api.getSubjects(batchId);
        if (response && response.success && Array.isArray(response.subjects)) {
          const newSubjectsJson = JSON.stringify(response.subjects);
          const oldSubjectsJson = JSON.stringify(cachedSubjects || []);

          this.state.subjectsCache[batchId] = response.subjects;
          localStorage.setItem('slaq_subjects_cache', JSON.stringify(this.state.subjectsCache));

          if (newSubjectsJson !== oldSubjectsJson) {
            const currentSelection = subjectSelector.value;
            subjectSelector.innerHTML = '<option value="" disabled selected>Choose Subject</option>';
            response.subjects.forEach(sub => {
              const opt = document.createElement('option');
              opt.value = sub.subject_id;
              opt.textContent = sub.subject_name;
              if (sub.subject_id === currentSelection) opt.selected = true;
              subjectSelector.appendChild(opt);
            });
            subjectSelector.disabled = false;
          }
        }
      } catch (error) {
        console.warn(`[Stale-While-Revalidate] Could not fetch live subjects for ${batchId}, maintaining instant local cache.`);
      }
    }
  },

  /**
   * Start Marking Session: Immediately load students defaulting to Present, check past records non-blocking in background
   */
  async startMarkingSession() {
    this.showScreen('marking-screen');

    // Update Header Labels
    const metaLabel = document.getElementById('marking-batch-subject-label');
    const dateLabel = document.getElementById('marking-date-label');
    metaLabel.textContent = `${this.state.batchName} · ${this.state.subjectName}`;
    dateLabel.textContent = this.state.date;

    const listContainer = document.getElementById('students-list-container');
    listContainer.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Loading students roster...</p>
      </div>
    `;

    try {
      // 1. Fetch active students immediately
      const studentsResp = await api.getStudents(this.state.batchId);
      if (!studentsResp || !studentsResp.success || !Array.isArray(studentsResp.students)) {
        throw new Error('Failed to fetch students list from server.');
      }
      this.state.students = studentsResp.students;

      // 2. Initialize attendance map with default 'Present' for instant marking
      this.state.attendanceMap = {};
      this.state.students.forEach(student => {
        const sid = String(student.student_id).trim();
        this.state.attendanceMap[sid] = 'Present';
      });

      // 3. Render student cards & counters right away without waiting for past records
      this.renderStudentRows();
      this.updateCounters();

      // 4. Non-Blocking Background Check for existing saved attendance records
      api.getAttendance(this.state.date, this.state.batchId, this.state.subjectId)
        .then((attResp) => {
          if (attResp && attResp.success && Array.isArray(attResp.records) && attResp.records.length > 0) {
            let updatedCount = 0;
            attResp.records.forEach(r => {
              const sid = String(r.student_id).trim();
              if (this.state.attendanceMap[sid] !== undefined) {
                this.setStudentStatus(sid, r.status);
                updatedCount++;
              }
            });
            if (updatedCount > 0) {
              this.showToast(`Loaded ${updatedCount} previously saved status record(s) for today.`, 'success');
            }
          }
        })
        .catch((e) => {
          console.warn('[Background Attendance Check] Could not check existing records or none found:', e.message);
        });

    } catch (error) {
      console.error('[Marking Session Error]', error);
      listContainer.innerHTML = `
        <div class="loading-state">
          <p style="color: #ef4444; font-weight: 600;">Error: ${error.message}</p>
          <button class="btn secondary-btn btn-sm mt-3" onclick="app.showScreen('home-screen')">← Back to Setup</button>
        </div>
      `;
    }
  },

  /**
   * Render Student Rows as a minimalistic table with default "Present" status
   */
  renderStudentRows() {
    const listContainer = document.getElementById('students-list-container');
    listContainer.innerHTML = '';

    if (this.state.students.length === 0) {
      listContainer.innerHTML = '<p class="text-muted text-center py-4">No active students found in this batch.</p>';
      return;
    }

    // Wrap table in responsive container
    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'table-responsive-wrapper';

    const table = document.createElement('table');
    table.className = 'minimal-attendance-table';

    table.innerHTML = `
      <thead>
        <tr>
          <th class="col-roll">Roll</th>
          <th class="col-name">Student Name</th>
          <th class="col-status">Status</th>
        </tr>
      </thead>
      <tbody id="attendance-tbody"></tbody>
    `;

    const tbody = table.querySelector('#attendance-tbody');

    this.state.students.forEach(student => {
      const sid = String(student.student_id).trim();
      const currentStatus = this.state.attendanceMap[sid] || 'Present';

      const row = document.createElement('tr');
      row.className = `student-tr status-${currentStatus.toLowerCase()}`;
      row.id = `row-${sid}`;

      row.innerHTML = `
        <td class="col-roll">
          <span class="roll-badge">${student.roll_no}</span>
        </td>
        <td class="col-name">
          <span class="name-text">${student.name}</span>
        </td>
        <td class="col-status">
          <div class="status-selector-table">
            <button type="button" class="status-pill present ${currentStatus === 'Present' ? 'active' : ''}" 
                    data-student="${sid}" data-status="Present" title="Mark Present">
              <span class="status-full">🟢 Present</span><span class="status-mobile">P</span>
            </button>
            <button type="button" class="status-pill late ${currentStatus === 'Late' ? 'active' : ''}" 
                    data-student="${sid}" data-status="Late" title="Mark Late">
              <span class="status-full">⏰ Late</span><span class="status-mobile">Lt</span>
            </button>
            <button type="button" class="status-pill absent ${currentStatus === 'Absent' ? 'active' : ''}" 
                    data-student="${sid}" data-status="Absent" title="Mark Absent">
              <span class="status-full">🔴 Absent</span><span class="status-mobile">A</span>
            </button>
            <button type="button" class="status-pill leave ${currentStatus === 'Leave' ? 'active' : ''}" 
                    data-student="${sid}" data-status="Leave" title="Mark Leave">
              <span class="status-full">🟡 Leave</span><span class="status-mobile">L</span>
            </button>
          </div>
        </td>
      `;

      // Add click listeners to status pills
      row.querySelectorAll('.status-pill').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const targetSid = btn.getAttribute('data-student');
          const targetStatus = btn.getAttribute('data-status');
          this.setStudentStatus(targetSid, targetStatus);
        });
      });

      tbody.appendChild(row);
    });

    tableWrapper.appendChild(table);
    listContainer.appendChild(tableWrapper);
  },

  /**
   * Update student status and refresh DOM table UI / sticky counters
   */
  setStudentStatus(studentId, newStatus) {
    this.state.attendanceMap[studentId] = newStatus;

    const row = document.getElementById(`row-${studentId}`);
    if (row) {
      row.className = `student-tr status-${newStatus.toLowerCase()}`;
      row.querySelectorAll('.status-pill').forEach(btn => {
        if (btn.getAttribute('data-status') === newStatus) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }

    this.updateCounters();
  },

  /**
   * Recalculate sticky header counters: Present, Absent, Leave
   */
  updateCounters() {
    let present = 0, late = 0, absent = 0, leave = 0;

    for (const status of Object.values(this.state.attendanceMap)) {
      if (status === 'Present') present++;
      else if (status === 'Late') late++;
      else if (status === 'Absent') absent++;
      else if (status === 'Leave') leave++;
    }

    document.getElementById('cnt-present').textContent = present;
    document.getElementById('cnt-late').textContent = late;
    document.getElementById('cnt-absent').textContent = absent;
    document.getElementById('cnt-leave').textContent = leave;
  },

  /**
   * Submit Attendance to API or queue offline in IndexedDB
   */
  async submitAttendancePayload() {
    const submitBtn = document.getElementById('submit-attendance-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving Attendance...';

    // Build records array
    const records = Object.entries(this.state.attendanceMap).map(([sid, status]) => ({
      student_id: sid,
      status: status
    }));

    const payload = {
      date: this.state.date,
      batch_id: this.state.batchId,
      subject_id: this.state.subjectId,
      teacher: 'Teacher', // Teacher identity
      records: records
    };

    try {
      const response = await api.submitAttendance(payload);
      if (response && response.success) {
        this.showToast(`Successfully saved ${response.saved || records.length} attendance records!`, 'success');
        this.showScreen('home-screen');
      } else {
        throw new Error(response.message || 'Server returned an error.');
      }
    } catch (error) {
      // If network error occurred, automatically route to offline IndexedDB queue (`db.js`)
      if (error.isNetworkError || !navigator.onLine) {
        try {
          await db.queueAttendance(payload);
          this.showToast('Saved offline! Will sync automatically when Wi-Fi/data is restored.', 'warning');
          this.showScreen('home-screen');
        } catch (queueErr) {
          console.error('[Offline Queue Critical Error]', queueErr);
          this.showToast('Failed to save both online and offline. Please check browser storage permissions.', 'error');
        }
      } else {
        console.error('[Submit Attendance Error]', error);
        this.showToast(`Could not submit: ${error.message}`, 'error');
      }
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save Attendance & Sync';
    }
  },

  /* ============================================================================
   * REPORTS SCREEN HANDLING
   * ============================================================================ */

  /**
   * Initialize dropdowns for Student and Subject Reports
   */
  async initReportsScreen() {
    const studentSelector = document.getElementById('report-student-selector');
    const subjectSelector = document.getElementById('report-subject-selector');

    studentSelector.innerHTML = '<option value="" disabled selected>Loading students...</option>';
    subjectSelector.innerHTML = '<option value="" disabled selected>Loading subjects...</option>';

    try {
      // Load batches first to get all students across B1 and B2
      const [studentsB1, studentsB2, batchesResp] = await Promise.all([
        api.getStudents('B1').catch(() => ({ students: [] })),
        api.getStudents('B2').catch(() => ({ students: [] })),
        api.getBatches().catch(() => ({ batches: [] }))
      ]);

      const allStudents = [...(studentsB1.students || []), ...(studentsB2.students || [])];

      if (allStudents.length > 0) {
        studentSelector.innerHTML = '<option value="" disabled selected>Choose Student</option>';
        allStudents.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.student_id;
          opt.textContent = `${s.name} (${s.batch_id} - Roll ${s.roll_no})`;
          studentSelector.appendChild(opt);
        });
      } else {
        studentSelector.innerHTML = '<option value="" disabled>No students found</option>';
      }

      // Load all subjects across batches
      const [subjectsB1, subjectsB2] = await Promise.all([
        api.getSubjects('B1').catch(() => ({ subjects: [] })),
        api.getSubjects('B2').catch(() => ({ subjects: [] }))
      ]);

      const allSubjectsMap = new Map();
      [...(subjectsB1.subjects || []), ...(subjectsB2.subjects || [])].forEach(sub => {
        allSubjectsMap.set(sub.subject_id, sub);
      });
      this.state.reportsSubjectsMap = allSubjectsMap;

      if (allSubjectsMap.size > 0) {
        subjectSelector.innerHTML = '<option value="" disabled selected>Choose Subject</option>';
        allSubjectsMap.forEach(sub => {
          const opt = document.createElement('option');
          opt.value = sub.subject_id;
          opt.textContent = `${sub.subject_name} (${sub.batch_id})`;
          subjectSelector.appendChild(opt);
        });
      } else {
        subjectSelector.innerHTML = '<option value="" disabled>No subjects found</option>';
      }
    } catch (e) {
      console.error('[Init Reports Error]', e);
      this.showToast('Could not load students and subjects for reports.', 'error');
    }
  },

  /**
   * Load and render Individual Student Report
   */
  async loadStudentReportData(studentId) {
    const contentPanel = document.getElementById('student-report-content');
    const historyList = document.getElementById('student-history-list');

    contentPanel.classList.remove('hidden');
    historyList.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Calculating attendance percentage...</p></div>';

    try {
      const resp = await api.getReport(studentId);
      if (!resp || !resp.success) {
        throw new Error(resp?.message || 'Could not fetch student report.');
      }

      const { summary, records } = resp;

      document.getElementById('rep-student-percentage').textContent = `${summary.percentage}%`;
      document.getElementById('rep-student-present').textContent = summary.present;
      document.getElementById('rep-student-late').textContent = summary.late || 0;
      document.getElementById('rep-student-absent').textContent = summary.absent;
      document.getElementById('rep-student-leave').textContent = summary.leave;

      historyList.innerHTML = '';
      if (records.length === 0) {
        historyList.innerHTML = '<p class="text-muted py-3 text-center">No historical attendance records found for this student yet.</p>';
        return;
      }

      records.forEach(r => {
        const item = document.createElement('div');
        const st = String(r.status).toLowerCase();
        item.className = `history-item status-${st}`;
        item.innerHTML = `
          <div>
            <div class="history-date">${r.date}</div>
            <div class="history-meta">Subject: ${r.subject_id} · Marked by ${r.teacher || 'Teacher'}</div>
          </div>
          <span class="history-pill text-${st === 'present' ? 'green' : st === 'late' ? 'purple' : st === 'absent' ? 'red' : 'amber'}">
            ${r.status === 'Present' ? '🟢 Present' : r.status === 'Late' ? '⏰ Late' : r.status === 'Absent' ? '🔴 Absent' : '🟡 Leave'}
          </span>
        `;
        historyList.appendChild(item);
      });

    } catch (error) {
      console.error('[Student Report Error]', error);
      historyList.innerHTML = `<p class="text-red font-bold py-3 text-center">Error loading report: ${error.message}</p>`;
    }
  },

  /**
   * Load and render Subject Aggregate Report
   */
  async loadSubjectReportData(subjectId) {
    const contentPanel = document.getElementById('subject-report-content');
    const tbody = document.getElementById('subject-students-tbody');

    contentPanel.classList.remove('hidden');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4"><div class="spinner"></div><p>Calculating breakdown across all students...</p></td></tr>';

    try {
      const resp = await api.getSubjectReport(subjectId);
      if (!resp || !resp.success) {
        throw new Error(resp?.message || 'Could not fetch subject report.');
      }

      const { summary, students } = resp;

      document.getElementById('rep-subject-percentage').textContent = `${summary.overall_percentage}%`;
      document.getElementById('rep-subject-present').textContent = summary.present;
      document.getElementById('rep-subject-late').textContent = summary.late || 0;
      document.getElementById('rep-subject-absent').textContent = summary.absent;
      document.getElementById('rep-subject-leave').textContent = summary.leave;

      tbody.innerHTML = '';
      if (!Array.isArray(students) || students.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">No active students registered for this subject.</td></tr>';
        return;
      }

      students.forEach(s => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="rep-col-roll text-center"><strong>${s.roll_no}</strong></td>
          <td class="rep-col-name">${s.name}</td>
          <td class="rep-col-stat text-green font-bold text-center">${s.present}</td>
          <td class="rep-col-stat text-purple font-bold text-center">${s.late || 0}</td>
          <td class="rep-col-stat text-red font-bold text-center">${s.absent}</td>
          <td class="rep-col-stat text-amber font-bold text-center">${s.leave}</td>
          <td class="rep-col-rate text-center">
            <span class="pill ${s.percentage >= 75 ? 'highlight-blue' : s.percentage < 50 ? 'text-red' : ''}">
              ${s.percentage}%
            </span>
          </td>
        `;
        tbody.appendChild(tr);
      });

    } catch (error) {
      console.error('[Subject Report Error]', error);
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-red font-bold py-3">Error loading report: ${error.message}</td></tr>`;
    }
  },

  /**
   * Load and render Daily Date Inspection Report for selected Subject and Date
   */
  async loadSubjectDailyDateReport() {
    const subjectSelector = document.getElementById('report-subject-selector');
    const datePicker = document.getElementById('subject-report-date-picker');
    const tbody = document.getElementById('subject-daily-tbody');
    const editBtn = document.getElementById('edit-daily-attendance-btn');
    const saveBtn = document.getElementById('save-daily-attendance-btn');
    const dateLabel = document.getElementById('rep-daily-date-label');

    if (!subjectSelector || !subjectSelector.value) {
      this.showToast('Please select a subject first.', 'warning');
      return;
    }

    const subjectId = subjectSelector.value;
    const selectedDate = datePicker && datePicker.value ? datePicker.value : this.state.date;
    if (datePicker && !datePicker.value) {
      datePicker.value = selectedDate;
    }
    if (dateLabel) {
      dateLabel.textContent = selectedDate;
    }

    const subInfo = this.state.reportsSubjectsMap ? this.state.reportsSubjectsMap.get(subjectId) : null;
    const batchId = subInfo ? subInfo.batch_id : (subjectSelector.options[subjectSelector.selectedIndex].textContent.includes('B1') ? 'B1' : 'B2');

    this.state.dailyInspectionState = {
      subjectId,
      batchId,
      date: selectedDate,
      students: [],
      attendanceMap: {},
      isEditing: false
    };

    if (editBtn) editBtn.classList.remove('hidden');
    if (saveBtn) saveBtn.classList.add('hidden');

    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-center py-4"><div class="spinner"></div><p>Loading attendance snapshot for ' + selectedDate + '...</p></td></tr>';
    }

    try {
      const [studentsResp, attResp] = await Promise.all([
        api.getStudents(batchId).catch(() => ({ students: [] })),
        api.getAttendance(selectedDate, batchId, subjectId).catch(() => ({ records: [] }))
      ]);

      const studentsList = studentsResp.students || [];
      this.state.dailyInspectionState.students = studentsList;

      const attMap = {};
      const records = attResp.records || [];
      records.forEach(r => {
        attMap[String(r.student_id).trim()] = r.status;
      });
      this.state.dailyInspectionState.attendanceMap = attMap;

      let presentCount = 0;
      let lateCount = 0;
      let absentCount = 0;
      let leaveCount = 0;
      let unmarkedCount = 0;

      if (!tbody) return;
      tbody.innerHTML = '';
      if (studentsList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3">No active students found in batch ' + batchId + '</td></tr>';
        return;
      }

      studentsList.forEach(s => {
        const sid = String(s.student_id).trim();
        const st = attMap[sid];

        if (st === 'Present') presentCount++;
        else if (st === 'Late') lateCount++;
        else if (st === 'Absent') absentCount++;
        else if (st === 'Leave') leaveCount++;
        else unmarkedCount++;

        const tr = document.createElement('tr');
        tr.className = `daily-tr status-${st ? st.toLowerCase() : 'unmarked'}`;
        tr.dataset.studentId = sid;

        let statusDisplay = '<span class="pill text-muted">⚪ Not Marked</span>';
        if (st === 'Present') statusDisplay = '<span class="pill text-green font-bold">🟢 Present</span>';
        else if (st === 'Late') statusDisplay = '<span class="pill text-purple font-bold">⏰ Late</span>';
        else if (st === 'Absent') statusDisplay = '<span class="pill text-red font-bold">🔴 Absent</span>';
        else if (st === 'Leave') statusDisplay = '<span class="pill text-amber font-bold">🟡 Leave</span>';

        tr.innerHTML = `
          <td class="col-roll"><strong>${s.roll_no}</strong></td>
          <td class="col-name">${s.name}</td>
          <td class="col-status daily-status-cell">${statusDisplay}</td>
        `;
        tbody.appendChild(tr);
      });

      const pElem = document.getElementById('rep-daily-present');
      const ltElem = document.getElementById('rep-daily-late');
      const aElem = document.getElementById('rep-daily-absent');
      const lElem = document.getElementById('rep-daily-leave');
      const uElem = document.getElementById('rep-daily-unmarked');
      if (pElem) pElem.textContent = presentCount;
      if (ltElem) ltElem.textContent = lateCount;
      if (aElem) aElem.textContent = absentCount;
      if (lElem) lElem.textContent = leaveCount;
      if (uElem) uElem.textContent = unmarkedCount;

    } catch (err) {
      console.error('[Load Daily Inspection Error]', err);
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-red font-bold py-3">Error loading date snapshot: ' + err.message + '</td></tr>';
      }
    }
  },

  /**
   * Enable interactive status toggling for previous day editing
   */
  enableDailyAttendanceEdit() {
    const editBtn = document.getElementById('edit-daily-attendance-btn');
    const saveBtn = document.getElementById('save-daily-attendance-btn');
    const tbody = document.getElementById('subject-daily-tbody');

    if (!this.state.dailyInspectionState || !this.state.dailyInspectionState.students.length) {
      this.showToast('No students loaded to edit.', 'warning');
      return;
    }

    this.state.dailyInspectionState.isEditing = true;
    if (editBtn) editBtn.classList.add('hidden');
    if (saveBtn) saveBtn.classList.remove('hidden');

    const attMap = this.state.dailyInspectionState.attendanceMap;

    if (tbody) {
      tbody.querySelectorAll('tr.daily-tr').forEach(tr => {
        const sid = tr.dataset.studentId;
        const currentSt = attMap[sid] || 'Present';
        attMap[sid] = currentSt;

        const statusCell = tr.querySelector('.daily-status-cell');
        if (statusCell) {
          statusCell.innerHTML = `
            <div class="status-selector-table">
              <button type="button" class="status-pill present ${currentSt === 'Present' ? 'active' : ''}" data-sid="${sid}" data-status="Present" title="Mark Present"><span class="status-full">🟢 Present</span><span class="status-mobile">P</span></button>
              <button type="button" class="status-pill late ${currentSt === 'Late' ? 'active' : ''}" data-sid="${sid}" data-status="Late" title="Mark Late"><span class="status-full">⏰ Late</span><span class="status-mobile">Lt</span></button>
              <button type="button" class="status-pill absent ${currentSt === 'Absent' ? 'active' : ''}" data-sid="${sid}" data-status="Absent" title="Mark Absent"><span class="status-full">🔴 Absent</span><span class="status-mobile">A</span></button>
              <button type="button" class="status-pill leave ${currentSt === 'Leave' ? 'active' : ''}" data-sid="${sid}" data-status="Leave" title="Mark Leave"><span class="status-full">🟡 Leave</span><span class="status-mobile">L</span></button>
            </div>
          `;
        }
      });

      tbody.querySelectorAll('.status-pill').forEach(pill => {
        pill.addEventListener('click', (e) => {
          const sid = e.currentTarget.dataset.sid;
          const newStatus = e.currentTarget.dataset.status;
          this.state.dailyInspectionState.attendanceMap[sid] = newStatus;

          const row = tbody.querySelector(`tr[data-student-id="${sid}"]`);
          if (row) {
            row.querySelectorAll('.status-pill').forEach(btn => btn.classList.remove('active'));
            e.currentTarget.classList.add('active');
            row.className = `daily-tr status-${newStatus.toLowerCase()}`;
          }
        });
      });
    }

    this.showToast('You can now edit status buttons for ' + this.state.dailyInspectionState.date + '.', 'info');
  },

  /**
   * Save updated daily attendance from Past Day Edit view
   */
  async saveDailyAttendanceEdit() {
    const saveBtn = document.getElementById('save-daily-attendance-btn');
    const stateObj = this.state.dailyInspectionState;

    if (!stateObj || !stateObj.subjectId || !stateObj.date) {
      return;
    }

    const records = Object.entries(stateObj.attendanceMap).map(([student_id, status]) => ({
      student_id,
      status
    }));

    const payload = {
      date: stateObj.date,
      batch_id: stateObj.batchId,
      subject_id: stateObj.subjectId,
      teacher: 'Teacher',
      records: records
    };

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
    }

    try {
      const resp = await api.submitAttendance(payload);
      if (resp && resp.success) {
        this.showToast(`Successfully updated ${records.length} records for ${stateObj.date}!`, 'success');
        await this.loadSubjectDailyDateReport();
        await this.loadSubjectReportData(stateObj.subjectId);
      } else {
        throw new Error(resp?.message || 'Could not update records.');
      }
    } catch (err) {
      console.error('[Save Daily Edit Error]', err);
      this.showToast('Could not save changes: ' + err.message, 'error');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 Save Changes';
      }
    }
  },

  /**
   * Display Notification Toast
   */
  showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : '⚠️';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
};

// Initialize app when DOM is fully loaded
window.addEventListener('DOMContentLoaded', () => {
  app.init();
});
