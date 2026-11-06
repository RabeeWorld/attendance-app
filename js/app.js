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
    date: (() => {
      const d = new Date();
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    })(),
    batchId: null,
    batchName: '',
    subjectId: null,
    subjectName: '',
    students: [],
    attendanceMap: {}, // student_id -> 'Present' | 'Absent' | 'Leave'
    isDirty: false,
    batchesCache: (() => {
      try {
        const saved = localStorage.getItem('slaq_batches_cache');
        if (saved) return JSON.parse(saved);
      } catch (e) { }
      return [];
    })(),
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
    studentsCache: (() => {
      try {
        const saved = localStorage.getItem('slaq_students_cache');
        if (saved) return JSON.parse(saved);
      } catch (e) { }
      return {};
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
    deferredPrompt: null,
    pdcStudentState: {
      records: [],
      summary: { total_amount: 0, today_amount: 0, days_contributed: 0 },
      todayEntry: null,
      selectedCalendarDate: null,
      calendarMonth: new Date().getMonth(),
      calendarYear: new Date().getFullYear(),
      isEditing: false,
      serverToday: null
    },
    pdcAdminState: {
      selectedDate: null,
      data: null,
      columnVisibility: (() => {
        try {
          const saved = JSON.parse(localStorage.getItem('slaq_pdc_col_prefs') || 'null');
          if (saved) return saved;
        } catch (e) {}
        return { amount: true, place: true, status: true };
      })(),
      lastSynced: null
    }
  },

  /**
   * Helper to get today's calendar date in local timezone formatted as YYYY-MM-DD
   */
  getLocalDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  /**
   * Initialize Application Lifecycle
   */
  async init() {
    this.setupEventListeners();
    this.setupNetworkMonitor();
    this.setupOfflineQueueMonitor();
    this.setupPWAInstallListener();

    // Initialize default date in picker to current local date
    const datePicker = document.getElementById('date-selector');
    if (datePicker) {
      this.state.date = this.getLocalDateString();
      datePicker.value = this.state.date;
    }

    // Check login state
    const loggedIn = localStorage.getItem('slaq_auth_logged_in') === 'true';
    if (loggedIn) {
      this.state.isAuthenticated = true;
      try {
        const savedUser = JSON.parse(localStorage.getItem('slaq_auth_user'));
        if (savedUser) this.state.user = savedUser;
      } catch (e) {}
      this.applyRBACAndRoute();
    } else {
      this.showScreen('login-screen');
    }
  },

  applyRBACAndRoute() {
    const user = this.state.user || { role: 'TEACHER' }; // Fallback
    const role = (user.role || '').toUpperCase();
    
    // Grab UI elements
    const homeNavBtn = document.getElementById('nav-home');
    const reportTabs = document.querySelector('.report-tabs');
    const studentReportSelectorArea = document.querySelector('#student-report-panel .filter-bar');
    const workspaceSubtitle = document.getElementById('workspace-subtitle');
    const reportBackBtn = document.getElementById('report-back-btn');
    const welcomeCard = document.getElementById('student-welcome-card');
    const reportsScreenHeader = document.getElementById('reports-screen-header');
    
    if (role === 'STUDENT') {
      // Hide marking screen nav
      if (homeNavBtn) homeNavBtn.style.display = 'none';
      // Hide report tabs, selector, and admin screen header
      if (reportTabs) reportTabs.style.display = 'none';
      if (studentReportSelectorArea) studentReportSelectorArea.style.display = 'none';
      if (workspaceSubtitle) workspaceSubtitle.classList.add('hidden');
      if (reportBackBtn) reportBackBtn.classList.add('hidden');
      if (reportsScreenHeader) reportsScreenHeader.classList.add('hidden');
      
      // Populate and show welcome card
      if (welcomeCard) {
        const d = new Date();
        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        const dateStr = d.toLocaleDateString('en-US', options);
        
        let displayName = user.name;
        if (!displayName && user.linked_student_id) {
          const allStudents = [...(this.state.studentsCache['B1']||[]), ...(this.state.studentsCache['B2']||[]), ...(this.state.studentsCache['CAMPUS']||[])];
          const found = allStudents.find(s => String(s.student_id).trim() === user.linked_student_id);
          if (found) displayName = found.name;
        }
        const titleText = displayName ? `Welcome back, ${displayName}!` : `Welcome back!`;
        
        welcomeCard.innerHTML = `
          <div class="welcome-content">
            <span class="welcome-date">${dateStr}</span>
            <h2 class="welcome-title">${titleText}</h2>
            <p class="welcome-subtitle">Always stay updated in your student portal</p>
          </div>
          <div class="welcome-icon">🎓</div>
        `;
        welcomeCard.classList.remove('hidden');
      }
      
      this.showScreen('reports-screen');
      
      const studentViewTabs = document.getElementById('student-view-tabs');
      if (studentViewTabs) studentViewTabs.classList.remove('hidden');
      const studentAttendanceTabBtn = document.getElementById('tab-student-attendance-btn');
      const studentPdcTabBtn = document.getElementById('tab-student-pdc-btn');
      if (studentAttendanceTabBtn) studentAttendanceTabBtn.classList.add('active');
      if (studentPdcTabBtn) studentPdcTabBtn.classList.remove('active');
      const studentReportPanel = document.getElementById('student-report-panel');
      if (studentReportPanel) studentReportPanel.classList.remove('hidden');
      const studentPdcPanel = document.getElementById('student-pdc-fund-panel');
      if (studentPdcPanel) studentPdcPanel.classList.add('hidden');
      const teacherPdcPanel = document.getElementById('pdc-fund-panel');
      if (teacherPdcPanel) teacherPdcPanel.classList.add('hidden');
      
      // Auto-load student report for this student
      if (user.linked_student_id) {
        this.loadStudentReportData(user.linked_student_id);
      } else {
        document.getElementById('student-history-list').innerHTML = '<p class="text-red font-bold p-4">Error: No student ID linked to this account.</p>';
      }
    } else {
      // Admin or Teacher: Full Access
      if (homeNavBtn) homeNavBtn.style.display = 'flex';
      if (reportTabs) reportTabs.style.display = 'flex';
      if (studentReportSelectorArea) studentReportSelectorArea.style.display = 'block';
      if (workspaceSubtitle) workspaceSubtitle.classList.remove('hidden');
      if (reportBackBtn) reportBackBtn.classList.remove('hidden');
      if (reportsScreenHeader) reportsScreenHeader.classList.remove('hidden');
      if (welcomeCard) welcomeCard.classList.add('hidden');
      const studentViewTabs = document.getElementById('student-view-tabs');
      if (studentViewTabs) studentViewTabs.classList.add('hidden');
      const studentPdcPanel = document.getElementById('student-pdc-fund-panel');
      if (studentPdcPanel) studentPdcPanel.classList.add('hidden');
      
      this.showScreen('home-screen');
      this.loadHomeSetupData();
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

    // Immediately reset scroll position to the very top when opening any screen
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
    const mainElem = document.querySelector('main');
    if (mainElem) mainElem.scrollTop = 0;

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
        const usernameInput = document.getElementById('username-input');
        const pinInput = document.getElementById('pin-input');
        const loginError = document.getElementById('login-error');
        const submitBtn = document.getElementById('login-submit-btn');

        loginError.classList.add('hidden');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Verifying Credentials...';

        const usernameVal = usernameInput ? usernameInput.value.trim() : '';
        const pinVal = pinInput.value.trim();

        try {
          // Local offline bypass for admin/dev
          if (usernameVal.toLowerCase() === 'admin' && pinVal === window.CONFIG.DEFAULT_PIN) {
            this.state.isAuthenticated = true;
            this.state.user = { username: 'admin', role: 'ADMIN', linked_student_id: '' };
            localStorage.setItem('slaq_auth_logged_in', 'true');
            localStorage.setItem('slaq_auth_user', JSON.stringify(this.state.user));
            if (usernameInput) usernameInput.value = '';
            pinInput.value = '';
            this.applyRBACAndRoute();
            return;
          }

          const response = await api.login(usernameVal, pinVal);
          if (response && response.success) {
            this.state.isAuthenticated = true;
            this.state.user = response.user;
            localStorage.setItem('slaq_auth_logged_in', 'true');
            localStorage.setItem('slaq_auth_user', JSON.stringify(response.user));
            if (usernameInput) usernameInput.value = '';
            pinInput.value = '';
            this.applyRBACAndRoute();
          } else {
            loginError.textContent = response.message || 'Incorrect Username or PIN. Please try again.';
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
        localStorage.removeItem('slaq_auth_user');
        this.state.isAuthenticated = false;
        this.state.user = null;
        this.resetUserState();
        const workspaceSubtitle = document.getElementById('workspace-subtitle');
        if (workspaceSubtitle) workspaceSubtitle.classList.add('hidden');
        this.showScreen('login-screen');
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
        this.state.isDirty = true;
        for (const student of this.state.students) {
          this.setStudentStatus(student.student_id, 'Present');
        }
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

    // 8. Report Type Tabs (Student vs Subject vs Campus)
    const tabStudentBtn = document.getElementById('tab-student-btn');
    const tabSubjectBtn = document.getElementById('tab-subject-btn');
    const tabCampusBtn = document.getElementById('tab-campus-btn');
    const tabPrayersBtn = document.getElementById('tab-prayers-btn');
    const studentPanel = document.getElementById('student-report-panel');
    const subjectPanel = document.getElementById('subject-report-panel');
    const campusPanel = document.getElementById('campus-report-panel');
    const prayersPanel = document.getElementById('prayers-report-panel');
    const tabPdcFundBtn = document.getElementById('tab-pdc-fund-btn');
    const pdcPanel = document.getElementById('pdc-fund-panel');

    if (tabStudentBtn && tabSubjectBtn && tabCampusBtn && tabPrayersBtn) {
      tabStudentBtn.addEventListener('click', () => {
        tabStudentBtn.classList.add('active-tab');
        tabSubjectBtn.classList.remove('active-tab');
        tabCampusBtn.classList.remove('active-tab');
        tabPrayersBtn.classList.remove('active-tab');
        studentPanel.classList.remove('hidden');
        subjectPanel.classList.add('hidden');
        campusPanel.classList.add('hidden');
        prayersPanel.classList.add('hidden');
        if (pdcPanel) pdcPanel.classList.add('hidden');
        if (tabPdcFundBtn) tabPdcFundBtn.classList.remove('active-tab');
      });

      tabSubjectBtn.addEventListener('click', () => {
        tabSubjectBtn.classList.add('active-tab');
        tabStudentBtn.classList.remove('active-tab');
        tabCampusBtn.classList.remove('active-tab');
        tabPrayersBtn.classList.remove('active-tab');
        subjectPanel.classList.remove('hidden');
        studentPanel.classList.add('hidden');
        campusPanel.classList.add('hidden');
        prayersPanel.classList.add('hidden');
        if (pdcPanel) pdcPanel.classList.add('hidden');
        if (tabPdcFundBtn) tabPdcFundBtn.classList.remove('active-tab');
      });

      tabCampusBtn.addEventListener('click', () => {
        tabCampusBtn.classList.add('active-tab');
        tabStudentBtn.classList.remove('active-tab');
        tabSubjectBtn.classList.remove('active-tab');
        tabPrayersBtn.classList.remove('active-tab');
        campusPanel.classList.remove('hidden');
        studentPanel.classList.add('hidden');
        subjectPanel.classList.add('hidden');
        prayersPanel.classList.add('hidden');
        if (pdcPanel) pdcPanel.classList.add('hidden');
        if (tabPdcFundBtn) tabPdcFundBtn.classList.remove('active-tab');
      });

      tabPrayersBtn.addEventListener('click', () => {
        tabPrayersBtn.classList.add('active-tab');
        tabStudentBtn.classList.remove('active-tab');
        tabSubjectBtn.classList.remove('active-tab');
        tabCampusBtn.classList.remove('active-tab');
        prayersPanel.classList.remove('hidden');
        studentPanel.classList.add('hidden');
        subjectPanel.classList.add('hidden');
        campusPanel.classList.add('hidden');
        if (pdcPanel) pdcPanel.classList.add('hidden');
        if (tabPdcFundBtn) tabPdcFundBtn.classList.remove('active-tab');
        
        const repPrayersDate = document.getElementById('report-prayers-date');
        const contentPanel = document.getElementById('prayers-report-content');
        if (repPrayersDate && contentPanel && contentPanel.classList.contains('hidden')) {
          this.loadPrayersReportData(repPrayersDate.value);
        }
      });
    }

    // 8b. PDC Fund Main Tab for Teachers/Admins
    if (tabPdcFundBtn && pdcPanel) {
      tabPdcFundBtn.addEventListener('click', () => {
        tabPdcFundBtn.classList.add('active-tab');
        if (tabStudentBtn) tabStudentBtn.classList.remove('active-tab');
        if (tabSubjectBtn) tabSubjectBtn.classList.remove('active-tab');
        if (tabCampusBtn) tabCampusBtn.classList.remove('active-tab');
        if (tabPrayersBtn) tabPrayersBtn.classList.remove('active-tab');

        pdcPanel.classList.remove('hidden');

        // Reset to Daily subsection by default
        const subDailyBtn = document.getElementById('pdc-subtab-daily-btn');
        const subAlltimeBtn = document.getElementById('pdc-subtab-alltime-btn');
        const dailySub = document.getElementById('pdc-daily-subsection');
        const alltimeSub = document.getElementById('pdc-alltime-subsection');
        if (subDailyBtn) subDailyBtn.classList.add('active-tab');
        if (subAlltimeBtn) subAlltimeBtn.classList.remove('active-tab');
        if (dailySub) dailySub.classList.remove('hidden');
        if (alltimeSub) alltimeSub.classList.add('hidden');
        if (studentPanel) studentPanel.classList.add('hidden');
        if (subjectPanel) subjectPanel.classList.add('hidden');
        if (campusPanel) campusPanel.classList.add('hidden');
        if (prayersPanel) prayersPanel.classList.add('hidden');

        const datePicker = document.getElementById('pdc-admin-date-picker');
        if (datePicker) {
          if (!datePicker.value) {
            datePicker.value = this.getLocalDateString();
          }
          this.loadTeacherPdcFundReport(datePicker.value);
        }
      });
    }

    // 8c. Student View Sub-Tabs (Attendance vs PDC Fund)
    const tabStudentAttendanceBtn = document.getElementById('tab-student-attendance-btn');
    const tabStudentPdcBtn = document.getElementById('tab-student-pdc-btn');
    const studentReportPanel = document.getElementById('student-report-panel');
    const studentPdcPanel = document.getElementById('student-pdc-fund-panel');

    if (tabStudentAttendanceBtn && tabStudentPdcBtn) {
      tabStudentAttendanceBtn.addEventListener('click', () => {
        tabStudentAttendanceBtn.classList.add('active');
        tabStudentPdcBtn.classList.remove('active');
        if (studentReportPanel) studentReportPanel.classList.remove('hidden');
        if (studentPdcPanel) studentPdcPanel.classList.add('hidden');
      });

      tabStudentPdcBtn.addEventListener('click', () => {
        tabStudentPdcBtn.classList.add('active');
        tabStudentAttendanceBtn.classList.remove('active');
        if (studentReportPanel) studentReportPanel.classList.add('hidden');
        if (studentPdcPanel) studentPdcPanel.classList.remove('hidden');

        const user = this.state.user;
        if (user && user.linked_student_id) {
          this.loadStudentPdcFundData(user.linked_student_id);
        }
      });
    }

    // 8c-2. PDC Fund Inner Subsection Tabs (Daily Collections vs All-Time Overview)
    const pdcSubtabDailyBtn = document.getElementById('pdc-subtab-daily-btn');
    const pdcSubtabAlltimeBtn = document.getElementById('pdc-subtab-alltime-btn');
    const pdcDailySubsection = document.getElementById('pdc-daily-subsection');
    const pdcAlltimeSubsection = document.getElementById('pdc-alltime-subsection');

    if (pdcSubtabDailyBtn && pdcSubtabAlltimeBtn && pdcDailySubsection && pdcAlltimeSubsection) {
      pdcSubtabDailyBtn.addEventListener('click', () => {
        pdcSubtabDailyBtn.classList.add('active-tab');
        pdcSubtabAlltimeBtn.classList.remove('active-tab');
        pdcDailySubsection.classList.remove('hidden');
        pdcAlltimeSubsection.classList.add('hidden');
      });

      pdcSubtabAlltimeBtn.addEventListener('click', () => {
        pdcSubtabAlltimeBtn.classList.add('active-tab');
        pdcSubtabDailyBtn.classList.remove('active-tab');
        pdcAlltimeSubsection.classList.remove('hidden');
        pdcDailySubsection.classList.add('hidden');

        // Render cumulative rankings
        if (this.state.pdcAdminState.data && this.state.pdcAdminState.data.students) {
          this.renderOverallStudentRankings(this.state.pdcAdminState.data.students);
        } else {
          this.loadTeacherPdcFundReport(this.getLocalDateString());
        }
      });
    }

    // 8d. Teacher PDC Fund Controls (Date Picker, Refresh, Column Toggles)
    const pdcAdminDatePicker = document.getElementById('pdc-admin-date-picker');
    if (pdcAdminDatePicker) {
      pdcAdminDatePicker.addEventListener('change', (e) => {
        if (e.target.value) {
          this.loadTeacherPdcFundReport(e.target.value);
        }
      });
    }

    const pdcAdminRefreshBtn = document.getElementById('pdc-admin-refresh-btn');
    if (pdcAdminRefreshBtn) {
      pdcAdminRefreshBtn.addEventListener('click', () => {
        const picker = document.getElementById('pdc-admin-date-picker');
        const selectedDate = picker && picker.value ? picker.value : this.getLocalDateString();
        this.loadTeacherPdcFundReport(selectedDate, true);
      });
    }

    // Column Toggles
    const toggleAmountBtn = document.getElementById('toggle-col-amount-btn');
    const togglePlaceBtn = document.getElementById('toggle-col-place-btn');
    const toggleStatusBtn = document.getElementById('toggle-col-status-btn');

    if (toggleAmountBtn) {
      toggleAmountBtn.addEventListener('click', () => {
        const current = this.state.pdcAdminState.columnVisibility.amount !== false;
        this.state.pdcAdminState.columnVisibility.amount = !current;
        this.savePdcColumnPrefs();
        this.applyTeacherPdcColumnVisibility();
      });
    }

    if (togglePlaceBtn) {
      togglePlaceBtn.addEventListener('click', () => {
        const current = this.state.pdcAdminState.columnVisibility.place !== false;
        this.state.pdcAdminState.columnVisibility.place = !current;
        this.savePdcColumnPrefs();
        this.applyTeacherPdcColumnVisibility();
      });
    }

    if (toggleStatusBtn) {
      toggleStatusBtn.addEventListener('click', () => {
        const current = this.state.pdcAdminState.columnVisibility.status !== false;
        this.state.pdcAdminState.columnVisibility.status = !current;
        this.savePdcColumnPrefs();
        this.applyTeacherPdcColumnVisibility();
      });
    }

    // Modal close listeners
    const modalCloseBtn = document.getElementById('pdc-modal-close-btn');
    const modalOverlay = document.getElementById('pdc-student-detail-modal');
    if (modalCloseBtn && modalOverlay) {
      modalCloseBtn.addEventListener('click', () => {
        modalOverlay.classList.add('hidden');
      });
      modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) {
          modalOverlay.classList.add('hidden');
        }
      });
    }

    // 9. Prayers Inner Tabs
    const prayersDailyBtn = document.getElementById('prayers-daily-btn');
    const prayersOverallBtn = document.getElementById('prayers-overall-btn');
    const prayersDailyFilter = document.getElementById('prayers-daily-filter');
    const prayersReportContent = document.getElementById('prayers-report-content');
    const prayersOverallContent = document.getElementById('prayers-overall-content');

    if (prayersDailyBtn && prayersOverallBtn) {
      prayersDailyBtn.addEventListener('click', () => {
        prayersDailyBtn.classList.add('active-tab');
        prayersOverallBtn.classList.remove('active-tab');
        prayersDailyFilter.classList.remove('hidden');
        prayersReportContent.classList.remove('hidden');
        prayersOverallContent.classList.add('hidden');
      });

      prayersOverallBtn.addEventListener('click', () => {
        prayersOverallBtn.classList.add('active-tab');
        prayersDailyBtn.classList.remove('active-tab');
        prayersDailyFilter.classList.add('hidden');
        prayersReportContent.classList.add('hidden');
        prayersOverallContent.classList.remove('hidden');
        this.loadPrayersOverallData();
      });
    }

    // 10. Report Selectors Change
    const repPrayersDate = document.getElementById('report-prayers-date');
    if (repPrayersDate) {
      // Set to today's date by default
      const today = new Date();
      repPrayersDate.value = today.toISOString().split('T')[0];
      repPrayersDate.addEventListener('change', async (e) => {
        await this.loadPrayersReportData(e.target.value);
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
    if (repSubjectSelector) {
      repSubjectSelector.addEventListener('change', async (e) => {
        await this.loadSubjectReportData(e.target.value);
      });
    }

    const repCampusSelector = document.getElementById('report-campus-selector');
    if (repCampusSelector) {
      repCampusSelector.addEventListener('change', async (e) => {
        await this.loadCampusReportData(e.target.value);
      });
    }

    // 10. Daily Date Inspection Navigation & Controls
    const navToDailyInspectionBtn = document.getElementById('nav-to-daily-inspection-btn');
    if (navToDailyInspectionBtn) {
      navToDailyInspectionBtn.addEventListener('click', async () => {
        await this.openDailyInspectionScreen();
      });
    }

    const dailyInspectionBackBtn = document.getElementById('daily-inspection-back-btn');
    if (dailyInspectionBackBtn) {
      dailyInspectionBackBtn.addEventListener('click', () => {
        this.showScreen('home-screen');
      });
    }

    const dailySubjectSelector = document.getElementById('daily-inspection-subject-selector');
    const dailyCampusSelector = document.getElementById('daily-inspection-campus-selector');

    if (dailySubjectSelector) {
      dailySubjectSelector.addEventListener('change', async () => {
        if (dailyCampusSelector) dailyCampusSelector.value = ''; // Reset the other dropdown
        await this.loadSubjectDailyDateReport();
      });
    }

    if (dailyCampusSelector) {
      dailyCampusSelector.addEventListener('change', async () => {
        if (dailySubjectSelector) dailySubjectSelector.value = ''; // Reset the other dropdown
        await this.loadSubjectDailyDateReport();
      });
    }

    const dailyDatePicker = document.getElementById('daily-inspection-date-picker');
    if (dailyDatePicker) {
      dailyDatePicker.addEventListener('change', async () => {
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

    const cancelDailyBtn = document.getElementById('cancel-daily-attendance-btn');
    if (cancelDailyBtn) {
      cancelDailyBtn.addEventListener('click', async () => {
        if (this.state.dailyInspectionState) {
          this.state.dailyInspectionState.isEditing = false;
        }
        await this.loadSubjectDailyDateReport();
      });
    }
  },

  /**
   * Load Batches & Setup Cache for Home Screen (Instant 0ms render + Stale-While-Revalidate)
   */
  async loadHomeSetupData() {
    try {
      // 0ms Instant Load: Immediately display cached batch titles & student counts before network check!
      if (Array.isArray(this.state.batchesCache) && this.state.batchesCache.length > 0) {
        this.state.batchesCache.forEach(b => {
          const countElem = document.getElementById(`batch-count-${b.batch_id}`);
          if (countElem) countElem.textContent = `${b.batch_name.split('(')[0].trim()} · ${b.student_count} Students`;
          const btn = document.querySelector(`.batch-btn[data-batch-id="${b.batch_id}"]`);
          if (btn) btn.setAttribute('data-batch-name', `${b.batch_name} (${b.student_count} Students)`);
        });
      }

      if (navigator.onLine) {
        api.getBootstrapData().then(res => {
          if (res && res.success) {
            if (Array.isArray(res.batches)) {
              this.state.batchesCache = res.batches;
              localStorage.setItem('slaq_batches_cache', JSON.stringify(res.batches));
              res.batches.forEach(b => {
                const countElem = document.getElementById(`batch-count-${b.batch_id}`);
                if (countElem) countElem.textContent = `${b.batch_name.split('(')[0].trim()} · ${b.student_count} Students`;
                const btn = document.querySelector(`.batch-btn[data-batch-id="${b.batch_id}"]`);
                if (btn) btn.setAttribute('data-batch-name', `${b.batch_name} (${b.student_count} Students)`);
              });
            }
            if (Array.isArray(res.subjectsB1) && res.subjectsB1.length > 0) this.state.subjectsCache['B1'] = res.subjectsB1;
            if (Array.isArray(res.subjectsB2) && res.subjectsB2.length > 0) this.state.subjectsCache['B2'] = res.subjectsB2;
            if (Array.isArray(res.subjectsCampus) && res.subjectsCampus.length > 0) this.state.subjectsCache['CAMPUS'] = res.subjectsCampus;
            if (Array.isArray(res.subjectsPrayers) && res.subjectsPrayers.length > 0) this.state.subjectsCache['PRAYERS'] = res.subjectsPrayers;
            
            if (Array.isArray(res.studentsB1) && res.studentsB1.length > 0) this.state.studentsCache['B1'] = res.studentsB1;
            if (Array.isArray(res.studentsB2) && res.studentsB2.length > 0) this.state.studentsCache['B2'] = res.studentsB2;
            if (Array.isArray(res.studentsCampus) && res.studentsCampus.length > 0) this.state.studentsCache['CAMPUS'] = res.studentsCampus;
            if (Array.isArray(res.studentsPrayers) && res.studentsPrayers.length > 0) this.state.studentsCache['PRAYERS'] = res.studentsPrayers;

            localStorage.setItem('slaq_subjects_cache', JSON.stringify(this.state.subjectsCache));
            localStorage.setItem('slaq_students_cache', JSON.stringify(this.state.studentsCache));
            localStorage.setItem('slaq_cache_timestamp', String(Date.now()));
          }
        }).catch(err => {
          console.warn('[Bootstrap Prefetch] Falling back to separate batch/subject prefetch:', err.message);
          api.getBatches().then(response => {
            if (response && response.success && Array.isArray(response.batches)) {
              this.state.batchesCache = response.batches;
              localStorage.setItem('slaq_batches_cache', JSON.stringify(response.batches));
              response.batches.forEach(b => {
                const countElem = document.getElementById(`batch-count-${b.batch_id}`);
                if (countElem) countElem.textContent = `${b.batch_name.split('(')[0].trim()} · ${b.student_count} Students`;
                const btn = document.querySelector(`.batch-btn[data-batch-id="${b.batch_id}"]`);
                if (btn) btn.setAttribute('data-batch-name', `${b.batch_name} (${b.student_count} Students)`);
              });
            }
          }).catch(() => {});
          ['B1', 'B2', 'CAMPUS'].forEach(bId => {
            api.getSubjects(bId).then(res => {
              if (res && res.success && Array.isArray(res.subjects) && res.subjects.length > 0) {
                this.state.subjectsCache[bId] = res.subjects;
                localStorage.setItem('slaq_subjects_cache', JSON.stringify(this.state.subjectsCache));
              }
            }).catch(() => {});
            api.getStudents(bId).then(res => {
              if (res && res.success && Array.isArray(res.students) && res.students.length > 0) {
                this.state.studentsCache[bId] = res.students;
                localStorage.setItem('slaq_students_cache', JSON.stringify(this.state.studentsCache));
              }
            }).catch(() => {});
          });
        });
      } else {
        console.log('[Offline Setup] Using cached batches, subjects and students');
      }
    } catch (error) {
      console.error('[Load Setup Error]', error);
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
   * Local Attendance Snapshot Helpers (Indexed by date, batch_id, subject_id)
   */
  saveLocalAttendanceSnapshot(date, batchId, subjectId, attendanceMap) {
    if (!date || !batchId || !subjectId || !attendanceMap) return;
    try {
      const key = `slaq_att_${date}_${batchId}_${subjectId}`;
      localStorage.setItem(key, JSON.stringify(attendanceMap));
    } catch (e) {
      console.warn('[Snapshot Cache] Could not save local attendance snapshot:', e.message);
    }
  },

  getLocalAttendanceSnapshot(date, batchId, subjectId) {
    if (!date || !batchId || !subjectId) return null;
    try {
      const key = `slaq_att_${date}_${batchId}_${subjectId}`;
      const saved = localStorage.getItem(key);
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return null;
  },

  /**
   * Start Marking Session: Instantaneous 0ms render from cached students/attendance + Stale-While-Revalidate background sync
   */
  async startMarkingSession() {
    this.showScreen('marking-screen');
    this.state.isDirty = false;

    const markingScreen = document.getElementById('marking-screen');
    if (this.state.batchId === 'PRAYERS') {
      markingScreen.classList.add('prayers-mode');
    } else {
      markingScreen.classList.remove('prayers-mode');
    }

    const metaLabel = document.getElementById('marking-batch-subject-label');
    const dateLabel = document.getElementById('marking-date-label');
    metaLabel.textContent = `${this.state.batchName} · ${this.state.subjectName}`;
    dateLabel.textContent = this.state.date;

    const listContainer = document.getElementById('students-list-container');
    const cachedStudents = this.state.studentsCache[this.state.batchId] || [];
    const localAttSnapshot = this.getLocalAttendanceSnapshot(this.state.date, this.state.batchId, this.state.subjectId);

    const initAttendanceMap = (studentsList) => {
      studentsList.forEach(student => {
        const sid = String(student.student_id).trim();
        if (localAttSnapshot && localAttSnapshot[sid]) {
          this.state.attendanceMap[sid] = localAttSnapshot[sid];
        } else if (this.state.attendanceMap[sid] === undefined) {
          this.state.attendanceMap[sid] = 'Present';
        }
      });
    };

    if (cachedStudents.length > 0) {
      // 0ms Instant Load!
      this.state.students = cachedStudents;
      this.state.attendanceMap = {};
      initAttendanceMap(this.state.students);
      this.renderStudentRows();
      this.updateCounters();
    } else {
      listContainer.innerHTML = `
        <div class="loading-state">
          <div class="spinner"></div>
          <p>Loading students roster...</p>
        </div>
      `;
    }

    const originalMetaText = `${this.state.batchName} · ${this.state.subjectName}`;
    metaLabel.innerHTML = `${originalMetaText} <span class="sync-indicator" style="font-size:0.8rem; opacity:0.85; margin-left:8px;">⏳ Checking cloud records...</span>`;

    try {
      // 1. Fetch live students (or offline fallback from api.js)
      const studentsResp = await api.getStudents(this.state.batchId);
      if (!studentsResp || !studentsResp.success || !Array.isArray(studentsResp.students)) {
        if (cachedStudents.length === 0) throw new Error('Failed to fetch students list from server.');
      } else {
        const oldJson = JSON.stringify(this.state.students || []);
        const newJson = JSON.stringify(studentsResp.students);
        this.state.studentsCache[this.state.batchId] = studentsResp.students;
        localStorage.setItem('slaq_students_cache', JSON.stringify(this.state.studentsCache));

        if (oldJson !== newJson || cachedStudents.length === 0) {
          this.state.students = studentsResp.students;
          if (!this.state.isDirty) {
            this.state.attendanceMap = {};
            initAttendanceMap(this.state.students);
            this.renderStudentRows();
            this.updateCounters();
          }
        }
      }

      // 2. Non-Blocking Background Check for existing saved attendance records today
      api.getAttendance(this.state.date, this.state.batchId, this.state.subjectId)
        .then((attResp) => {
          if (attResp && attResp.success && Array.isArray(attResp.records) && attResp.records.length > 0) {
            const fetchedMap = {};
            attResp.records.forEach(r => {
              const sid = String(r.student_id).trim();
              fetchedMap[sid] = r.status;
            });
            this.saveLocalAttendanceSnapshot(this.state.date, this.state.batchId, this.state.subjectId, fetchedMap);

            if (!this.state.isDirty) {
              let updatedCount = 0;
              attResp.records.forEach(r => {
                const sid = String(r.student_id).trim();
                if (this.state.attendanceMap[sid] !== undefined && this.state.attendanceMap[sid] !== r.status) {
                  this.setStudentStatus(sid, r.status);
                  updatedCount++;
                }
              });
            }
          }
        })
        .catch((e) => {
          console.warn('[Background Attendance Check] Could not check existing records or none found:', e.message);
        })
        .finally(() => {
          if (metaLabel) metaLabel.textContent = originalMetaText;
        });

    } catch (error) {
      console.error('[Marking Session Error]', error);
      if (metaLabel) metaLabel.textContent = originalMetaText;
      if (cachedStudents.length === 0) {
        listContainer.innerHTML = `
          <div class="loading-state">
            <p style="color: #ef4444; font-weight: 600;">Error: ${error.message}</p>
            <button class="btn secondary-btn btn-sm mt-3" onclick="app.showScreen('home-screen')">← Back to Setup</button>
          </div>
        `;
      }
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

    const isCampus = String(this.state.batchId).trim().toUpperCase() === 'CAMPUS';
    const isPrayers = String(this.state.batchId).trim().toUpperCase() === 'PRAYERS';
    let currentBatchGroup = null;

    // Sort students by batch_id then roll_no so headers don't repeat
    const sortedStudents = [...this.state.students].sort((a, b) => {
      if (isCampus || isPrayers) {
        const batchDiff = String(a.batch_id || '').localeCompare(String(b.batch_id || ''));
        if (batchDiff !== 0) return batchDiff;
      }
      return Number(a.roll_no) - Number(b.roll_no);
    });

    sortedStudents.forEach(student => {
      const sid = String(student.student_id).trim();
      const currentStatus = this.state.attendanceMap[sid] || (isPrayers ? 'Present' : 'Present');

      // Insert Batch Separation Header if CAMPUS or PRAYERS
      if ((isCampus || isPrayers) && student.batch_id !== currentBatchGroup) {
        currentBatchGroup = student.batch_id;
        const headerRow = document.createElement('tr');
        headerRow.className = 'batch-separator-row';
        headerRow.innerHTML = `<th colspan="3" style="text-align: left; padding: 12px; background: rgba(0,0,0,0.05); font-weight: 600; color: #475569; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px;">Batch ${currentBatchGroup}</th>`;
        tbody.appendChild(headerRow);
      }

      const row = document.createElement('tr');
      row.className = `student-tr status-${currentStatus.toLowerCase()}`;
      row.id = `row-${sid}`;

      if (isPrayers) {
        row.innerHTML = `
          <td class="col-roll">
            <span class="roll-badge">${student.roll_no}</span>
          </td>
          <td class="col-name">
            <span class="name-text">${student.name}</span>
          </td>
          <td class="col-status">
            <div class="status-selector-table prayers-mode">
              <button type="button" class="status-pill prayer-btn ${currentStatus === 'Present' ? 'present' : 'absent'} active" 
                      data-student="${sid}" data-status="${currentStatus === 'Present' ? 'Present' : 'Absent'}" title="Toggle Status">
                ${currentStatus === 'Present' ? 'P' : 'A'}
              </button>
              <button type="button" class="status-pill leave ${currentStatus === 'Leave' ? 'active' : ''}" 
                      data-student="${sid}" data-status="Leave" title="Mark Leave">
                <span class="status-full">🟡 Leave</span><span class="status-mobile">L</span>
              </button>
            </div>
          </td>
        `;
      } else {
        const lateBtn = isCampus ? '' : `
              <button type="button" class="status-pill late ${currentStatus === 'Late' ? 'active' : ''}" 
                      data-student="${sid}" data-status="Late" title="Mark Late">
                <span class="status-full">⏰ Late</span><span class="status-mobile">Lt</span>
              </button>`;
        
        const leaveBtn = isCampus ? '' : `
              <button type="button" class="status-pill leave ${currentStatus === 'Leave' ? 'active' : ''}" 
                      data-student="${sid}" data-status="Leave" title="Mark Leave">
                <span class="status-full">🟡 Leave</span><span class="status-mobile">L</span>
              </button>`;

        row.innerHTML = `
          <td class="col-roll">
            <span class="roll-badge">${student.roll_no}</span>
          </td>
          <td class="col-name">
            <span class="name-text">${student.name}</span>
          </td>
          <td class="col-status">
            <div class="status-selector-table ${isCampus ? 'campus-mode' : ''}">
              <button type="button" class="status-pill present ${currentStatus === 'Present' ? 'active' : ''}" 
                      data-student="${sid}" data-status="Present" title="Mark Present">
                <span class="status-full">🟢 Present</span><span class="status-mobile">P</span>
              </button>
              ${lateBtn}
              <button type="button" class="status-pill absent ${currentStatus === 'Absent' ? 'active' : ''}" 
                      data-student="${sid}" data-status="Absent" title="Mark Absent">
                <span class="status-full">🔴 Absent</span><span class="status-mobile">A</span>
              </button>
              ${leaveBtn}
            </div>
          </td>
        `;
      }

      // Add click listeners to status pills
      row.querySelectorAll('.status-pill').forEach(btn => {
        btn.addEventListener('click', (e) => {
          this.state.isDirty = true;
          const targetSid = btn.getAttribute('data-student');
          
          if (btn.classList.contains('prayer-btn')) {
             const current = btn.getAttribute('data-status');
             const newTargetStatus = current === 'Present' ? 'Absent' : 'Present';
             this.setStudentStatus(targetSid, newTargetStatus);
          } else {
             const targetStatus = btn.getAttribute('data-status');
             this.setStudentStatus(targetSid, targetStatus);
          }
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
      
      const isPrayers = String(this.state.batchId).trim().toUpperCase() === 'PRAYERS';
      if (isPrayers) {
        const prayerBtn = row.querySelector('.prayer-btn');
        if (prayerBtn) {
          if (newStatus === 'Present') {
            prayerBtn.className = 'status-pill prayer-btn present active';
            prayerBtn.setAttribute('data-status', 'Present');
            prayerBtn.textContent = 'P';
          } else if (newStatus === 'Absent') {
            prayerBtn.className = 'status-pill prayer-btn absent active';
            prayerBtn.setAttribute('data-status', 'Absent');
            prayerBtn.textContent = 'A';
          } else {
            // Leave mode - unhighlight prayer btn but keep it as Present by default 
            prayerBtn.className = 'status-pill prayer-btn present';
            prayerBtn.setAttribute('data-status', 'Present');
            prayerBtn.textContent = 'P';
          }
        }
      }

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
        this.saveLocalAttendanceSnapshot(this.state.date, this.state.batchId, this.state.subjectId, { ...this.state.attendanceMap });
        localStorage.removeItem('slaq_student_reports_cache');
        localStorage.removeItem('slaq_subject_reports_cache');
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
          this.saveLocalAttendanceSnapshot(this.state.date, this.state.batchId, this.state.subjectId, { ...this.state.attendanceMap });
          localStorage.removeItem('slaq_student_reports_cache');
          localStorage.removeItem('slaq_subject_reports_cache');
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
   * Initialize dropdowns for Student and Subject Reports (Instant 0ms render from cache)
   */
  async initReportsScreen() {
    const studentSelector = document.getElementById('report-student-selector');
    const subjectSelector = document.getElementById('report-subject-selector');
    const campusSelector = document.getElementById('report-campus-selector');

    // Instant 0ms Load from Local Cache!
    const cachedStudentsB1 = this.state.studentsCache['B1'] || [];
    const cachedStudentsB2 = this.state.studentsCache['B2'] || [];
    const cachedStudentsCampus = this.state.studentsCache['CAMPUS'] || [];
    const allCachedStudentsMap = new Map();
    [...cachedStudentsB1, ...cachedStudentsB2, ...cachedStudentsCampus].forEach(s => allCachedStudentsMap.set(s.student_id, s));
    const allCachedStudents = Array.from(allCachedStudentsMap.values());

    const cachedSubjectsB1 = this.state.subjectsCache['B1'] || [];
    const cachedSubjectsB2 = this.state.subjectsCache['B2'] || [];
    const cachedSubjectsCampus = this.state.subjectsCache['CAMPUS'] || [];
    const cachedSubjectsPrayers = this.state.subjectsCache['PRAYERS'] || [];
    const allCachedSubjectsMap = new Map();
    [...cachedSubjectsB1, ...cachedSubjectsB2, ...cachedSubjectsCampus, ...cachedSubjectsPrayers].forEach(sub => allCachedSubjectsMap.set(sub.subject_id, sub));

    if (allCachedStudents.length > 0) {
      const curStudent = studentSelector.value;
      studentSelector.innerHTML = '<option value="" disabled selected>Choose Student</option>';
      allCachedStudents.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.student_id;
        opt.textContent = `${s.name} (${s.batch_id} - Roll ${s.roll_no})`;
        if (s.student_id === curStudent) opt.selected = true;
        studentSelector.appendChild(opt);
      });
    } else {
      studentSelector.innerHTML = '<option value="" disabled selected>Loading students...</option>';
    }

    if (allCachedSubjectsMap.size > 0) {
      this.state.reportsSubjectsMap = allCachedSubjectsMap;
      const curSubject = subjectSelector.value;
      const curCampus = campusSelector ? campusSelector.value : '';
      subjectSelector.innerHTML = '<option value="" disabled selected>Choose Subject</option>';
      if (campusSelector) campusSelector.innerHTML = '<option value="" disabled selected>Choose Campus Presence</option>';

      allCachedSubjectsMap.forEach(sub => {
        const opt = document.createElement('option');
        opt.value = sub.subject_id;
        opt.textContent = `${sub.subject_name} (${sub.batch_id})`;
        if (String(sub.batch_id).trim().toUpperCase() === 'CAMPUS') {
          if (campusSelector) {
            if (sub.subject_id === curCampus) opt.selected = true;
            campusSelector.appendChild(opt);
          }
        } else {
          if (sub.subject_id === curSubject) opt.selected = true;
          subjectSelector.appendChild(opt);
        }
      });
    } else {
      subjectSelector.innerHTML = '<option value="" disabled selected>Loading subjects...</option>';
      if (campusSelector) campusSelector.innerHTML = '<option value="" disabled selected>Loading presence...</option>';
    }

    // Stale-While-Revalidate background sync
    if (navigator.onLine) {
      Promise.all([
        api.getStudents('B1').catch(() => ({ students: [] })),
        api.getStudents('B2').catch(() => ({ students: [] })),
        api.getSubjects('B1').catch(() => ({ subjects: [] })),
        api.getSubjects('B2').catch(() => ({ subjects: [] })),
        api.getSubjects('CAMPUS').catch(() => ({ subjects: [] }))
      ]).then(([studentsB1, studentsB2, subjectsB1, subjectsB2, subjectsCampus]) => {
        const allStudents = [...(studentsB1.students || []), ...(studentsB2.students || [])];
        if (allStudents.length > 0) {
          if (Array.isArray(studentsB1.students)) this.state.studentsCache['B1'] = studentsB1.students;
          if (Array.isArray(studentsB2.students)) this.state.studentsCache['B2'] = studentsB2.students;
          localStorage.setItem('slaq_students_cache', JSON.stringify(this.state.studentsCache));

          if (allCachedStudents.length === 0 || studentSelector.options.length <= 1) {
            const curStudent = studentSelector.value;
            studentSelector.innerHTML = '<option value="" disabled selected>Choose Student</option>';
            allStudents.forEach(s => {
              const opt = document.createElement('option');
              opt.value = s.student_id;
              opt.textContent = `${s.name} (${s.batch_id} - Roll ${s.roll_no})`;
              if (s.student_id === curStudent) opt.selected = true;
              studentSelector.appendChild(opt);
            });
          }
        }

        const allSubjectsMap = new Map();
        [...(subjectsB1.subjects || []), ...(subjectsB2.subjects || []), ...(subjectsCampus.subjects || [])].forEach(sub => {
          allSubjectsMap.set(sub.subject_id, sub);
        });
        this.state.reportsSubjectsMap = allSubjectsMap;
        if (Array.isArray(subjectsB1.subjects)) this.state.subjectsCache['B1'] = subjectsB1.subjects;
        if (Array.isArray(subjectsB2.subjects)) this.state.subjectsCache['B2'] = subjectsB2.subjects;
        if (Array.isArray(subjectsCampus.subjects)) this.state.subjectsCache['CAMPUS'] = subjectsCampus.subjects;
        localStorage.setItem('slaq_subjects_cache', JSON.stringify(this.state.subjectsCache));

        if (allCachedSubjectsMap.size === 0 || subjectSelector.options.length <= 1) {
          const curSubject = subjectSelector.value;
          const curCampus = campusSelector ? campusSelector.value : '';
          subjectSelector.innerHTML = '<option value="" disabled selected>Choose Subject</option>';
          if (campusSelector) campusSelector.innerHTML = '<option value="" disabled selected>Choose Campus Presence</option>';

          allSubjectsMap.forEach(sub => {
            const opt = document.createElement('option');
            opt.value = sub.subject_id;
            opt.textContent = `${sub.subject_name} (${sub.batch_id})`;
            if (String(sub.batch_id).trim().toUpperCase() === 'CAMPUS') {
              if (campusSelector) {
                if (sub.subject_id === curCampus) opt.selected = true;
                campusSelector.appendChild(opt);
              }
            } else {
              if (sub.subject_id === curSubject) opt.selected = true;
              subjectSelector.appendChild(opt);
            }
          });
        }
      }).catch(e => console.warn('[Reports Sync] Maintaining cached dropdown options:', e.message));
    }
  },

  /**
   * Load and render Individual Student Report
   */
  /**
   * Reset user state & clear cached DOM elements upon logout or user switch
   */
  resetUserState() {
    this.state.pdcStudentState = {
      records: [],
      summary: { total_amount: 0, today_amount: 0, days_contributed: 0 },
      todayEntry: null,
      selectedCalendarDate: null,
      calendarMonth: new Date().getMonth(),
      calendarYear: new Date().getFullYear(),
      isEditing: false,
      serverToday: null
    };

    // Reset Attendance Summary DOM
    const pctEl = document.getElementById('rep-student-percentage');
    const presEl = document.getElementById('rep-student-present');
    const lateEl = document.getElementById('rep-student-late');
    const absEl = document.getElementById('rep-student-absent');
    const leaveEl = document.getElementById('rep-student-leave');
    const histList = document.getElementById('student-history-list');
    if (pctEl) pctEl.textContent = '0%';
    if (presEl) presEl.textContent = '0';
    if (lateEl) lateEl.textContent = '0';
    if (absEl) absEl.textContent = '0';
    if (leaveEl) leaveEl.textContent = '0';
    if (histList) histList.innerHTML = '';

    // Reset PDC Fund Summary DOM
    const totalEl = document.getElementById('pdc-student-total-collected');
    const todayEl = document.getElementById('pdc-student-today-collected');
    const badgeEl = document.getElementById('pdc-student-today-badge');
    const daysEl = document.getElementById('pdc-student-days-contributed');
    const container = document.getElementById('pdc-student-entry-container');
    const calGrid = document.getElementById('pdc-mini-calendar-grid');
    const dateDetail = document.getElementById('pdc-selected-date-detail');

    if (totalEl) totalEl.textContent = '₹0';
    if (todayEl) todayEl.textContent = '₹0';
    if (daysEl) daysEl.textContent = '0 Days';
    if (badgeEl) {
      badgeEl.className = 'stat-unit badge-pill';
      badgeEl.textContent = 'Pending Submission';
    }
    if (container) container.innerHTML = '';
    if (calGrid) calGrid.innerHTML = '';
    if (dateDetail) dateDetail.innerHTML = '';

    // Reset Student Welcome Card
    const welcomeCard = document.getElementById('student-welcome-card');
    if (welcomeCard) {
      welcomeCard.innerHTML = '';
      welcomeCard.classList.add('hidden');
    }
  },

  async loadStudentReportData(studentId) {
    const contentPanel = document.getElementById('student-report-content');
    const historyList = document.getElementById('student-history-list');

    // Immediately reset stat numbers so previous student's stats don't flash
    const pctEl = document.getElementById('rep-student-percentage');
    const presEl = document.getElementById('rep-student-present');
    const lateEl = document.getElementById('rep-student-late');
    const absEl = document.getElementById('rep-student-absent');
    const leaveEl = document.getElementById('rep-student-leave');
    if (pctEl) pctEl.textContent = '...';
    if (presEl) presEl.textContent = '...';
    if (lateEl) lateEl.textContent = '...';
    if (absEl) absEl.textContent = '...';
    if (leaveEl) leaveEl.textContent = '...';

    contentPanel.classList.remove('hidden');
    historyList.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Calculating attendance percentage...</p></div>';

    try {
      const resp = await api.getReport(studentId);
      if (!resp || !resp.success) {
        throw new Error(resp?.message || 'Could not fetch student report.');
      }

      const { summary, records, student } = resp;

      const role = (this.state.user?.role || '').toUpperCase();
      if (role === 'STUDENT' && student && student.name) {
        if (!this.state.user.name) {
          this.state.user.name = student.name;
          localStorage.setItem('slaq_auth_user', JSON.stringify(this.state.user));
        }
        const welcomeTitle = document.querySelector('#student-welcome-card .welcome-title');
        if (welcomeTitle) {
          welcomeTitle.textContent = `Welcome back, ${student.name}!`;
        }
      }

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

      const getSubjectName = (sid) => {
        if (this.state.reportsSubjectsMap && this.state.reportsSubjectsMap.has(sid)) {
          return this.state.reportsSubjectsMap.get(sid).subject_name;
        }
        const allSubjects = [
          ...(this.state.subjectsCache['B1'] || []),
          ...(this.state.subjectsCache['B2'] || []),
          ...(this.state.subjectsCache['PRAYERS'] || [])
        ];
        const found = allSubjects.find(s => String(s.subject_id).trim() === String(sid).trim());
        return found ? found.subject_name : sid;
      };

      // Group records by date
      const groupedRecords = {};
      records.forEach(r => {
        if (!groupedRecords[r.date]) groupedRecords[r.date] = [];
        groupedRecords[r.date].push(r);
      });

      // Calendar state
      let currentDate = new Date();
      if (records.length > 0) {
        const firstRecordDate = new Date(records[0].date);
        if (!isNaN(firstRecordDate)) currentDate = firstRecordDate;
      }
      
      let selectedDateString = records.length > 0 ? records[0].date : null;

      const renderCalendar = (dateObj) => {
        const year = dateObj.getFullYear();
        const month = dateObj.getMonth();
        
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        document.getElementById('mc-month-year').textContent = `${monthNames[month]} ${year}`;
        
        const grid = document.getElementById('mini-calendar-grid');
        grid.innerHTML = '';
        
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        
        for (let i = 0; i < firstDay; i++) {
          const empty = document.createElement('div');
          empty.className = 'mc-day empty';
          grid.appendChild(empty);
        }
        
        for (let i = 1; i <= daysInMonth; i++) {
          const dayCell = document.createElement('div');
          dayCell.className = 'mc-day';
          dayCell.textContent = i;
          
          const cellDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
          
          if (groupedRecords[cellDateStr]) {
            dayCell.classList.add('has-data');
          }
          if (cellDateStr === selectedDateString) {
            dayCell.classList.add('selected');
          }
          
          dayCell.addEventListener('click', () => {
            document.querySelectorAll('.mc-day').forEach(el => el.classList.remove('selected'));
            dayCell.classList.add('selected');
            selectedDateString = cellDateStr;
            renderLogsForSelectedDate();
          });
          
          grid.appendChild(dayCell);
        }
      };

      const renderLogsForSelectedDate = () => {
        historyList.innerHTML = '';
        const label = document.getElementById('mc-selected-date-label');
        
        if (!selectedDateString) {
          label.textContent = 'Select a date from the calendar';
          return;
        }
        
        const displayDate = new Date(selectedDateString);
        label.textContent = `Logs for ${isNaN(displayDate) ? selectedDateString : displayDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`;
        
        const dayRecords = groupedRecords[selectedDateString] || [];
        
        if (dayRecords.length === 0) {
          historyList.innerHTML = '<p class="text-muted py-3 text-center">No attendance tracked on this day.</p>';
          return;
        }
        
        dayRecords.forEach(r => {
          const item = document.createElement('div');
          const st = String(r.status).toLowerCase();
          const subjectDisplay = getSubjectName(r.subject_id);
          item.className = `history-item status-${st}`;
          item.innerHTML = `
            <div>
              <div class="history-meta" style="font-weight:600; color:var(--text-primary); font-size:1rem; margin-bottom: 2px;">${subjectDisplay}</div>
              <div class="history-meta" style="font-size:0.75rem;">Marked by ${r.teacher || 'Teacher'}</div>
            </div>
            <span class="history-pill text-${st === 'present' ? 'green' : st === 'late' ? 'purple' : st === 'absent' ? 'red' : 'amber'}">
              ${r.status === 'Present' ? '🟢 Present' : r.status === 'Late' ? '⏰ Late' : r.status === 'Absent' ? '🔴 Absent' : '🟡 Leave'}
            </span>
          `;
          historyList.appendChild(item);
        });
      };

      document.getElementById('mc-prev-month').onclick = () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        renderCalendar(currentDate);
      };
      
      document.getElementById('mc-next-month').onclick = () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        renderCalendar(currentDate);
      };

      renderCalendar(currentDate);
      renderLogsForSelectedDate();

      // BUILD SUBJECT BREAKDOWN TABLE
      const subjectStats = {};
      records.forEach(r => {
        if (String(r.batch_id).trim() === 'CAMPUS' || String(r.batch_id).trim() === 'PRAYERS') return;
        const sid = r.subject_id;
        if (!subjectStats[sid]) {
          subjectStats[sid] = { present: 0, late: 0, absent: 0, leave: 0, total: 0 };
        }
        const st = String(r.status).toLowerCase();
        if (st === 'present') subjectStats[sid].present++;
        else if (st === 'late') subjectStats[sid].late++;
        else if (st === 'absent') subjectStats[sid].absent++;
        else if (st === 'leave') subjectStats[sid].leave++;
        
        subjectStats[sid].total++;
      });
      
      const breakdownTbody = document.getElementById('student-subject-breakdown-tbody');
      if (breakdownTbody) {
        breakdownTbody.innerHTML = '';
        const subjectKeys = Object.keys(subjectStats);
        if (subjectKeys.length === 0) {
          breakdownTbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">No subject attendance data available.</td></tr>';
        } else {
          subjectKeys.forEach(sid => {
            const stats = subjectStats[sid];
            const p = stats.present;
            const l = stats.late;
            const a = stats.absent;
            const lv = stats.leave;
            const denom = p + l + a + lv;
            const rate = denom > 0 ? ((p + l) / denom * 100).toFixed(1) : 0;
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
              <td style="font-weight: 600;">${getSubjectName(sid)}</td>
              <td class="text-green">${p}</td>
              <td class="text-purple">${l}</td>
              <td class="text-red">${a}</td>
              <td class="text-amber">${lv}</td>
              <td><span class="highlight-blue" style="padding: 4px 10px; font-size: 0.9rem;">${rate}%</span></td>
            `;
            breakdownTbody.appendChild(tr);
          });
        }
      }


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
      document.getElementById('rep-subject-classes-taken').textContent = summary.total_classes_taken || 0;
      document.getElementById('rep-subject-present').textContent = summary.present;
      document.getElementById('rep-subject-late').textContent = summary.late || 0;
      document.getElementById('rep-subject-absent').textContent = summary.absent;
      document.getElementById('rep-subject-leave').textContent = summary.leave;

      tbody.innerHTML = '';
      if (!Array.isArray(students) || students.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">No active students registered for this subject.</td></tr>';
        return;
      }

      // Move students without roll numbers to the bottom, preserving existing order
      const withRoll = students.filter(s => s.roll_no && String(s.roll_no).trim() !== '');
      const withoutRoll = students.filter(s => !s.roll_no || String(s.roll_no).trim() === '');
      const rearrangedStudents = [...withRoll, ...withoutRoll];

      rearrangedStudents.forEach(s => {
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
   * Load and render Campus Report
   */
  async loadCampusReportData(subjectId) {
    const contentPanel = document.getElementById('campus-report-content');
    const tbody = document.getElementById('campus-students-tbody');

    contentPanel.classList.remove('hidden');

    const morningCard = document.getElementById('card-morning-checkin');
    const nightCard = document.getElementById('card-night-checkin');
    const morningVal = document.getElementById('rep-campus-morning-days');
    const nightVal = document.getElementById('rep-campus-night-days');

    const campusSelector = document.getElementById('report-campus-selector');
    const selectedText = campusSelector && campusSelector.options.length > 0 && campusSelector.selectedIndex >= 0 
                         ? campusSelector.options[campusSelector.selectedIndex].text.toLowerCase() 
                         : '';

    if (selectedText.includes('morning')) {
      if (morningCard) morningCard.classList.remove('hidden');
      if (nightCard) nightCard.classList.add('hidden');
      if (morningVal) morningVal.textContent = '...';
    } else if (selectedText.includes('night')) {
      if (morningCard) morningCard.classList.add('hidden');
      if (nightCard) nightCard.classList.remove('hidden');
      if (nightVal) nightVal.textContent = '...';
    } else {
      if (morningCard) morningCard.classList.add('hidden');
      if (nightCard) nightCard.classList.add('hidden');
    }

    tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4"><div class="spinner"></div><p>Calculating presence across all students...</p></td></tr>';

    try {
      const resp = await api.getSubjectReport(subjectId);
      if (!resp || !resp.success) {
        throw new Error(resp?.message || 'Could not fetch campus report.');
      }

      const { students, summary } = resp;

      if (selectedText.includes('morning')) {
        if (morningVal) morningVal.textContent = summary.total_classes_taken || 0;
      } else if (selectedText.includes('night')) {
        if (nightVal) nightVal.textContent = summary.total_classes_taken || 0;
      }

      tbody.innerHTML = '';
      if (!Array.isArray(students) || students.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">No active students registered for this campus presence.</td></tr>';
        return;
      }

      students.sort((a, b) => {
        const hasRollA = (a.roll_no && String(a.roll_no).trim() !== '') ? 1 : 0;
        const hasRollB = (b.roll_no && String(b.roll_no).trim() !== '') ? 1 : 0;

        // 1. Always put those without roll numbers at the bottom
        if (hasRollA !== hasRollB) return hasRollB - hasRollA;

        // 2. Sort by Present count (Descending)
        const presentA = Number(a.present) || 0;
        const presentB = Number(b.present) || 0;
        if (presentA !== presentB) return presentB - presentA;

        // 3. Fallback: Sort by Roll Number (Ascending)
        return Number(a.roll_no) - Number(b.roll_no);
      });

      let lastRollIndex = -1;
      for (let i = 0; i < students.length; i++) {
        if (students[i].roll_no && String(students[i].roll_no).trim() !== '') {
          lastRollIndex = i;
        } else {
          break;
        }
      }

      students.forEach((s, index) => {
        let rowClass = '';
        if (index < 3 && lastRollIndex >= index) {
          rowClass = 'top-rank-row';
        } else if (lastRollIndex >= 3 && index > lastRollIndex - 3 && index <= lastRollIndex) {
          rowClass = 'bottom-rank-row';
        }

        const tr = document.createElement('tr');
        if (rowClass) tr.className = rowClass;
        
        tr.innerHTML = `
          <td class="rep-col-roll text-center"><strong>${s.roll_no}</strong></td>
          <td class="rep-col-name">${s.name}</td>
          <td class="rep-col-stat text-green font-bold text-center">${s.present}</td>
          <td class="rep-col-stat text-red font-bold text-center">${s.absent}</td>
        `;
        tbody.appendChild(tr);
      });

    } catch (error) {
      console.error('[Campus Report Error]', error);
      tbody.innerHTML = `<tr><td colspan="4" class="text-center text-red font-bold py-3">Error loading report: ${error.message}</td></tr>`;
    }
  },

  /**
   * Open dedicated Daily Date Inspection screen and initialize dropdowns/date (Instant 0ms render from cache)
   */
  async openDailyInspectionScreen() {
    this.showScreen('daily-inspection-screen');
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));

    const subjectSelector = document.getElementById('daily-inspection-subject-selector');
    const datePicker = document.getElementById('daily-inspection-date-picker');

    if (datePicker && !datePicker.value) {
      datePicker.value = this.state.date || this.getLocalDateString();
    }

    if (!subjectSelector) return;

    // Instant 0ms Load from Local Cache!
    const cachedB1 = this.state.subjectsCache['B1'] || [];
    const cachedB2 = this.state.subjectsCache['B2'] || [];
    const cachedCampus = this.state.subjectsCache['CAMPUS'] || [];
    const allCachedMap = new Map();
    [...cachedB1, ...cachedB2, ...cachedCampus].forEach(sub => allCachedMap.set(sub.subject_id, sub));

    if (allCachedMap.size > 0) {
      this.state.reportsSubjectsMap = allCachedMap;
      const currentSelection = subjectSelector.value;
      subjectSelector.innerHTML = '<option value="" disabled selected>Choose Subject</option>';
      
      const campusSelector = document.getElementById('daily-inspection-campus-selector');
      const currentCampusSelection = campusSelector ? campusSelector.value : '';
      if (campusSelector) campusSelector.innerHTML = '<option value="" disabled selected>Choose Check-in</option>';

      allCachedMap.forEach(sub => {
        if (sub.batch_id === 'CAMPUS') {
          if (campusSelector) {
            const opt = document.createElement('option');
            opt.value = sub.subject_id;
            opt.textContent = sub.subject_name;
            if (sub.subject_id === currentCampusSelection) opt.selected = true;
            campusSelector.appendChild(opt);
          }
        } else {
          const opt = document.createElement('option');
          opt.value = sub.subject_id;
          opt.textContent = `${sub.subject_name} (${sub.batch_id})`;
          if (sub.subject_id === currentSelection) opt.selected = true;
          subjectSelector.appendChild(opt);
        }
      });
    } else {
      subjectSelector.innerHTML = '<option value="" disabled selected>Loading subjects...</option>';
      const campusSelector = document.getElementById('daily-inspection-campus-selector');
      if (campusSelector) campusSelector.innerHTML = '<option value="" disabled selected>Loading check-ins...</option>';
    }

    // Stale-While-Revalidate background sync
    if (navigator.onLine) {
      Promise.all([
        api.getSubjects('B1').catch(() => ({ subjects: [] })),
        api.getSubjects('B2').catch(() => ({ subjects: [] })),
        api.getSubjects('CAMPUS').catch(() => ({ subjects: [] }))
      ]).then(([subjectsB1, subjectsB2, subjectsCampus]) => {
        const allSubjectsMap = new Map();
        [...(subjectsB1.subjects || []), ...(subjectsB2.subjects || []), ...(subjectsCampus.subjects || [])].forEach(sub => {
          allSubjectsMap.set(sub.subject_id, sub);
        });
        this.state.reportsSubjectsMap = allSubjectsMap;
        if (Array.isArray(subjectsB1.subjects)) this.state.subjectsCache['B1'] = subjectsB1.subjects;
        if (Array.isArray(subjectsB2.subjects)) this.state.subjectsCache['B2'] = subjectsB2.subjects;
        if (Array.isArray(subjectsCampus.subjects)) this.state.subjectsCache['CAMPUS'] = subjectsCampus.subjects;
        localStorage.setItem('slaq_subjects_cache', JSON.stringify(this.state.subjectsCache));

        if (allCachedMap.size === 0 || subjectSelector.options.length <= 1) {
          const currentSelection = subjectSelector.value;
          subjectSelector.innerHTML = '<option value="" disabled selected>Choose Subject</option>';
          
          const campusSelector = document.getElementById('daily-inspection-campus-selector');
          const currentCampusSelection = campusSelector ? campusSelector.value : '';
          if (campusSelector) campusSelector.innerHTML = '<option value="" disabled selected>Choose Check-in</option>';

          allSubjectsMap.forEach(sub => {
            if (sub.batch_id === 'CAMPUS') {
              if (campusSelector) {
                const opt = document.createElement('option');
                opt.value = sub.subject_id;
                opt.textContent = sub.subject_name;
                if (sub.subject_id === currentCampusSelection) opt.selected = true;
                campusSelector.appendChild(opt);
              }
            } else {
              const opt = document.createElement('option');
              opt.value = sub.subject_id;
              opt.textContent = `${sub.subject_name} (${sub.batch_id})`;
              if (sub.subject_id === currentSelection) opt.selected = true;
              subjectSelector.appendChild(opt);
            }
          });
        }
      }).catch(e => console.warn('[Daily Inspection Sync] Maintaining cached subjects options:', e.message));
    }
  },

  /**
   * Load and render Daily Date Inspection Report for selected Subject and Date
   */
  async loadSubjectDailyDateReport() {
    const subjectSelector = document.getElementById('daily-inspection-subject-selector') || document.getElementById('report-subject-selector');
    const campusSelector = document.getElementById('daily-inspection-campus-selector');
    const datePicker = document.getElementById('daily-inspection-date-picker') || document.getElementById('subject-report-date-picker');
    const tbody = document.getElementById('subject-daily-tbody');
    const editBtn = document.getElementById('edit-daily-attendance-btn');
    const saveBtn = document.getElementById('save-daily-attendance-btn');
    const cancelBtn = document.getElementById('cancel-daily-attendance-btn');
    const dateLabel = document.getElementById('rep-daily-date-label');

    const activeSubjectId = (campusSelector && campusSelector.value) ? campusSelector.value : (subjectSelector ? subjectSelector.value : null);

    if (!activeSubjectId) {
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3">Select a subject or campus check-in to view daily snapshot</td></tr>';
      }
      return;
    }

    const subjectId = activeSubjectId;
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

    if (editBtn) editBtn.classList.add('hidden');
    if (saveBtn) saveBtn.classList.add('hidden');
    if (cancelBtn) cancelBtn.classList.add('hidden');

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

      const isCampus = String(batchId).trim().toUpperCase() === 'CAMPUS';
      let currentBatchGroup = null;

      const sortedStudentsList = [...studentsList].sort((a, b) => {
        if (isCampus) {
          const batchDiff = String(a.batch_id || '').localeCompare(String(b.batch_id || ''));
          if (batchDiff !== 0) return batchDiff;
        }
        return Number(a.roll_no) - Number(b.roll_no);
      });

      sortedStudentsList.forEach(s => {
        const sid = String(s.student_id).trim();
        const st = attMap[sid];

        if (st === 'Present') presentCount++;
        else if (st === 'Late') lateCount++;
        else if (st === 'Absent') absentCount++;
        else if (st === 'Leave') leaveCount++;
        else unmarkedCount++;

        if (isCampus && s.batch_id !== currentBatchGroup) {
          currentBatchGroup = s.batch_id;
          const headerRow = document.createElement('tr');
          headerRow.className = 'batch-separator-row';
          headerRow.innerHTML = `<th colspan="3" style="text-align: left; padding: 12px; background: rgba(0,0,0,0.05); font-weight: 600; color: #475569; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px;">Batch ${currentBatchGroup}</th>`;
          tbody.appendChild(headerRow);
        }

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

      const hasMarkedRecords = (presentCount + lateCount + absentCount + leaveCount) > 0 || Object.keys(attMap).length > 0;
      if (editBtn) {
        if (hasMarkedRecords) {
          editBtn.classList.remove('hidden');
        } else {
          editBtn.classList.add('hidden');
        }
      }

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
    const cancelBtn = document.getElementById('cancel-daily-attendance-btn');
    const tbody = document.getElementById('subject-daily-tbody');

    if (!this.state.dailyInspectionState || !this.state.dailyInspectionState.students.length) {
      this.showToast('No students loaded to edit.', 'warning');
      return;
    }

    this.state.dailyInspectionState.isEditing = true;
    if (editBtn) editBtn.classList.add('hidden');
    if (saveBtn) saveBtn.classList.remove('hidden');
    if (cancelBtn) cancelBtn.classList.remove('hidden');

    const attMap = this.state.dailyInspectionState.attendanceMap;

    if (tbody) {
      tbody.querySelectorAll('tr.daily-tr').forEach(tr => {
        const sid = tr.dataset.studentId;
        const currentSt = attMap[sid] || 'Present';
        attMap[sid] = currentSt;

        const statusCell = tr.querySelector('.daily-status-cell');
        if (statusCell) {
          const isCampus = String(this.state.dailyInspectionState.batchId).trim().toUpperCase() === 'CAMPUS';
          
          const lateBtn = isCampus ? '' : `
              <button type="button" class="status-pill late ${currentSt === 'Late' ? 'active' : ''}" data-sid="${sid}" data-status="Late" title="Mark Late"><span class="status-full">⏰ Late</span><span class="status-mobile">Lt</span></button>`;
          
          const leaveBtn = isCampus ? '' : `
              <button type="button" class="status-pill leave ${currentSt === 'Leave' ? 'active' : ''}" data-sid="${sid}" data-status="Leave" title="Mark Leave"><span class="status-full">🟡 Leave</span><span class="status-mobile">L</span></button>`;

          statusCell.innerHTML = `
            <div class="status-selector-table ${isCampus ? 'campus-mode' : ''}">
              <button type="button" class="status-pill present ${currentSt === 'Present' ? 'active' : ''}" data-sid="${sid}" data-status="Present" title="Mark Present"><span class="status-full">🟢 Present</span><span class="status-mobile">P</span></button>
              ${lateBtn}
              <button type="button" class="status-pill absent ${currentSt === 'Absent' ? 'active' : ''}" data-sid="${sid}" data-status="Absent" title="Mark Absent"><span class="status-full">🔴 Absent</span><span class="status-mobile">A</span></button>
              ${leaveBtn}
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
        this.saveLocalAttendanceSnapshot(stateObj.date, stateObj.batchId, stateObj.subjectId, { ...stateObj.attendanceMap });
        localStorage.removeItem('slaq_student_reports_cache');
        localStorage.removeItem('slaq_subject_reports_cache');
        this.showToast(`Successfully updated ${records.length} records for ${stateObj.date}!`, 'success');
        await this.loadSubjectDailyDateReport();
        await this.loadSubjectReportData(stateObj.subjectId);
      } else {
        throw new Error(resp?.message || 'Could not update records.');
      }
    } catch (err) {
      if (err.isNetworkError || !navigator.onLine) {
        try {
          await db.queueAttendance(payload);
          this.saveLocalAttendanceSnapshot(stateObj.date, stateObj.batchId, stateObj.subjectId, { ...stateObj.attendanceMap });
          localStorage.removeItem('slaq_student_reports_cache');
          localStorage.removeItem('slaq_subject_reports_cache');
          this.showToast('Updated offline! Will sync when connection is restored.', 'warning');
          await this.loadSubjectDailyDateReport();
          await this.loadSubjectReportData(stateObj.subjectId);
        } catch (queueErr) {
          console.error('[Offline Queue Critical Error]', queueErr);
          this.showToast('Could not save changes offline: ' + queueErr.message, 'error');
        }
      } else {
        console.error('[Save Daily Edit Error]', err);
        this.showToast('Could not save changes: ' + err.message, 'error');
      }
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 Save Changes';
      }
    }
  },

  /**
   * Load and render Prayers Report Data for a specific date
   */
  async loadPrayersReportData(dateStr) {
    const contentPanel = document.getElementById('prayers-report-content');
    const tbody = document.getElementById('prayers-students-tbody');

    contentPanel.classList.remove('hidden');
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4"><div class="spinner"></div><p>Fetching prayers data...</p></td></tr>';

    try {
      const resp = await api.getPrayersReport(dateStr);
      if (!resp || !resp.success) {
        throw new Error(resp?.message || 'Could not fetch prayers report.');
      }

      const { summary, students } = resp;

      tbody.innerHTML = '';
      if (!Array.isArray(students) || students.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">No active students or no attendance tracked yet.</td></tr>';
        return;
      }

      const prayersCache = this.state.subjectsCache['PRAYERS'] || [];
      const getPrayerId = (name) => {
         const found = prayersCache.find(s => String(s.subject_name).toLowerCase().includes(name.toLowerCase()));
         return found ? String(found.subject_id).trim() : name; // fallback
      };
      
      const prayerIds = [
         getPrayerId('Fajr'),
         getPrayerId('Dhuhr'),
         getPrayerId('Asr'),
         getPrayerId('Maghrib'),
         getPrayerId('Isha')
      ];

      students.forEach(student => {
        const tr = document.createElement('tr');
        let cellsHTML = '';
        
        prayerIds.forEach(pid => {
          const st = (student.attendance && student.attendance[pid]) ? String(student.attendance[pid]).toLowerCase() : '-';
          if (st === 'present') {
            cellsHTML += `<td class="rep-col-stat text-center"><span class="pill present">P</span></td>`;
          } else if (st === 'absent') {
            cellsHTML += `<td class="rep-col-stat text-center"><span class="pill absent">A</span></td>`;
          } else if (st === 'leave') {
            cellsHTML += `<td class="rep-col-stat text-center"><span class="pill leave">L</span></td>`;
          } else {
            cellsHTML += `<td class="rep-col-stat text-center text-muted">-</td>`;
          }
        });

        tr.innerHTML = `
          <td class="rep-col-roll">${student.roll_no}</td>
          <td class="rep-col-name" style="font-weight:600;">${student.name}</td>
          ${cellsHTML}
        `;
        tbody.appendChild(tr);
      });

    } catch (error) {
      console.error('[Prayers Report Error]', error);
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-red py-3 font-bold">Error loading report: ${error.message}</td></tr>`;
    }
  },

  /**
   * Load and render Prayers Overall Report (Total Missed)
   */
  async loadPrayersOverallData() {
    const tbody = document.getElementById('prayers-overall-tbody');
    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-4"><div class="spinner"></div><p>Fetching overall report...</p></td></tr>';

    try {
      const resp = await api.getPrayersOverallReport();
      if (!resp || !resp.success) {
        throw new Error(resp?.message || 'Could not fetch overall report.');
      }

      const { students } = resp;

      tbody.innerHTML = '';
      if (!Array.isArray(students) || students.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-3">No active students or no attendance tracked yet.</td></tr>';
        return;
      }

      const prayersCache = this.state.subjectsCache['PRAYERS'] || [];
      const getPrayerId = (name) => {
         const found = prayersCache.find(s => String(s.subject_name).toLowerCase().includes(name.toLowerCase()));
         return found ? String(found.subject_id).trim() : name; // fallback
      };
      
      const prayerIds = [
         getPrayerId('Fajr'),
         getPrayerId('Dhuhr'),
         getPrayerId('Asr'),
         getPrayerId('Maghrib'),
         getPrayerId('Isha')
      ];

      students.forEach(student => {
        const tr = document.createElement('tr');
        let cellsHTML = '';
        
        prayerIds.forEach(pid => {
          const missed = student.missed_counts[pid] || 0;
          if (missed > 0) {
            cellsHTML += `<td class="rep-col-stat text-center font-bold text-red" style="color: #dc2626;">${missed}</td>`;
          } else {
            cellsHTML += `<td class="rep-col-stat text-center text-muted">-</td>`;
          }
        });

        tr.innerHTML = `
          <td class="rep-col-roll">${student.roll_no}</td>
          <td class="rep-col-name" style="font-weight:600;">${student.name}</td>
          ${cellsHTML}
          <td class="text-center font-bold" style="color: #dc2626; font-size: 1.05rem;">${student.total_missed}</td>
        `;
        tbody.appendChild(tr);
      });

    } catch (error) {
      console.error('[Prayers Overall Report Error]', error);
      tbody.innerHTML = `<tr><td colspan="8" class="text-center text-red py-3 font-bold">Error loading report: ${error.message}</td></tr>`;
    }
  },

  /* ============================================================================
   * PDC FUND IMPLEMENTATION (Student & Teacher Dashboard)
   * ============================================================================ */

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  formatIsoTimestamp(isoString) {
    if (!isoString) return '-';
    try {
      let cleanIso = String(isoString).trim();

      // If timestamp has trailing 'Z' while being in local Kolkata time,
      // parse it without the 'Z' to avoid a redundant +5:30 UTC offset
      if (cleanIso.endsWith('Z') && !cleanIso.includes('+')) {
        const withoutZ = cleanIso.slice(0, -1);
        const testD = new Date(withoutZ);
        if (!isNaN(testD.getTime())) {
          return testD.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' +
                 testD.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
        }
      }

      const d = new Date(cleanIso);
      if (isNaN(d.getTime())) return isoString;
      return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' +
             d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch (e) {
      return isoString;
    }
  },

  savePdcColumnPrefs() {
    try {
      localStorage.setItem('slaq_pdc_col_prefs', JSON.stringify(this.state.pdcAdminState.columnVisibility));
    } catch (e) {}
  },

  /**
   * Load student PDC Fund details
   */
  async loadStudentPdcFundData(studentId) {
    if (!studentId) return;

    // Reset student state immediately so previous student's details never flash
    this.state.pdcStudentState = {
      records: [],
      summary: { total_amount: 0, today_amount: 0, days_contributed: 0 },
      todayEntry: null,
      selectedCalendarDate: null,
      calendarMonth: new Date().getMonth(),
      calendarYear: new Date().getFullYear(),
      isEditing: false,
      serverToday: null
    };

    // Immediately show loading placeholder on summary cards
    const totalEl = document.getElementById('pdc-student-total-collected');
    const todayEl = document.getElementById('pdc-student-today-collected');
    const badgeEl = document.getElementById('pdc-student-today-badge');
    const daysEl = document.getElementById('pdc-student-days-contributed');
    if (totalEl) totalEl.textContent = '...';
    if (todayEl) todayEl.textContent = '...';
    if (daysEl) daysEl.textContent = '...';
    if (badgeEl) {
      badgeEl.className = 'stat-unit badge-pill';
      badgeEl.textContent = '● Loading...';
    }

    const container = document.getElementById('pdc-student-entry-container');
    if (container) {
      container.innerHTML = '<p class="text-center py-4 text-muted">Loading your PDC Fund portal...</p>';
    }

    try {
      const data = await api.getPdcFundForStudent(studentId);
      if (data && data.success) {
        this.state.pdcStudentState.records = data.records || [];
        this.state.pdcStudentState.summary = data.summary || { total_amount: 0, today_amount: 0, days_contributed: 0 };
        this.state.pdcStudentState.todayEntry = data.today_entry || null;
        this.state.pdcStudentState.serverToday = data.server_today || this.getLocalDateString();

        if (!this.state.pdcStudentState.selectedCalendarDate) {
          this.state.pdcStudentState.selectedCalendarDate = this.state.pdcStudentState.serverToday;
        }

        this.renderStudentPdcSummary();
        this.renderStudentPdcEntryCard();
        this.renderStudentPdcCalendar();
      }
    } catch (err) {
      console.error('Error loading student PDC Fund:', err);
      this.showToast('Could not load PDC Fund details. Using local records.', 'warning');
    }
  },

  renderStudentPdcSummary() {
    const summary = this.state.pdcStudentState.summary || { total_amount: 0, today_amount: 0, days_contributed: 0 };
    const todayEntry = this.state.pdcStudentState.todayEntry;

    const totalEl = document.getElementById('pdc-student-total-collected');
    const todayEl = document.getElementById('pdc-student-today-collected');
    const badgeEl = document.getElementById('pdc-student-today-badge');
    const daysEl = document.getElementById('pdc-student-days-contributed');

    if (totalEl) totalEl.textContent = `₹${(summary.total_amount || 0).toLocaleString('en-IN')}`;
    if (todayEl) todayEl.textContent = `₹${(summary.today_amount || 0).toLocaleString('en-IN')}`;
    if (daysEl) daysEl.textContent = `${summary.days_contributed || 0} Days`;

    if (badgeEl) {
      if (todayEntry && Number(todayEntry.amount) > 0) {
        badgeEl.textContent = '● Submitted Today';
        badgeEl.className = 'stat-unit badge-pill count-present';
      } else {
        badgeEl.textContent = 'Pending Submission';
        badgeEl.className = 'stat-unit badge-pill count-unmarked';
      }
    }
  },

  renderStudentPdcEntryCard() {
    const container = document.getElementById('pdc-student-entry-container');
    if (!container) return;

    const user = this.state.user || {};
    const studentId = user.linked_student_id;
    const serverToday = this.state.pdcStudentState.serverToday || this.getLocalDateString();
    const todayEntry = this.state.pdcStudentState.todayEntry;
    const isEditing = this.state.pdcStudentState.isEditing;

    const todayDateObj = new Date();
    const formattedDate = todayDateObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    if (!todayEntry) {
      // State A: No entry exists for today -> Show Add Form
      container.innerHTML = `
        <div class="pdc-entry-header">
          <div>
            <h3 class="mb-0">Today's Fund Contribution</h3>
            <p class="text-muted mb-0" style="font-size: 0.85rem;">Add your collected fund amount for the current date.</p>
          </div>
          <span class="pdc-today-badge">📅 ${formattedDate}</span>
        </div>

        <form id="pdc-add-entry-form" class="mt-3">
          <div class="form-group mb-3">
            <label for="pdc-amount-input">Amount Collected (₹) *</label>
            <div class="pdc-input-with-symbol">
              <span class="pdc-currency-symbol">₹</span>
              <input type="number" id="pdc-amount-input" class="form-control" placeholder="Enter amount (e.g. 500)" min="1" step="any" required>
            </div>
          </div>
          <div class="form-group mb-3">
            <label for="pdc-place-input">Collection Place / Location *</label>
            <input type="text" id="pdc-place-input" class="form-control" placeholder="e.g. Kozhikode Town / Main Gate" required>
          </div>
          <button type="submit" id="pdc-submit-btn" class="btn primary-btn btn-lg w-100" style="margin-top: 10px;">
            <span>➕ Submit Today's Collection</span>
          </button>
        </form>
      `;

      const form = document.getElementById('pdc-add-entry-form');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const amtInput = document.getElementById('pdc-amount-input');
        const placeInput = document.getElementById('pdc-place-input');
        const submitBtn = document.getElementById('pdc-submit-btn');

        const amount = Number(amtInput.value);
        const place = placeInput.value.trim();

        if (isNaN(amount) || amount <= 0) {
          this.showToast('Amount must be greater than zero.', 'error');
          amtInput.focus();
          return;
        }
        if (!place) {
          this.showToast('Please mention the collection place.', 'error');
          placeInput.focus();
          return;
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Saving Entry...</span>';

        try {
          const res = await api.savePdcFundEntry({
            student_id: studentId,
            student_name: user.name || '',
            date: serverToday,
            amount: amount,
            place: place
          });

          if (res && res.success) {
            this.showToast('Fund entry saved successfully!', 'success');
            await this.loadStudentPdcFundData(studentId);
          } else {
            this.showToast(res.message || res.error || 'Failed to save fund entry.', 'error');
          }
        } catch (err) {
          console.error(err);
          this.showToast(err.message || 'Network error saving entry.', 'error');
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });

    } else if (isEditing) {
      // State C: Editing existing entry
      container.innerHTML = `
        <div class="pdc-entry-header">
          <div>
            <h3 class="mb-0">Edit Today's Fund Entry</h3>
            <p class="text-muted mb-0" style="font-size: 0.85rem;">Modify the amount or collection place for today.</p>
          </div>
          <span class="pdc-today-badge">📅 ${formattedDate}</span>
        </div>

        <form id="pdc-edit-entry-form" class="mt-3">
          <div class="form-group mb-3">
            <label for="pdc-edit-amount-input">Amount Collected (₹) *</label>
            <div class="pdc-input-with-symbol">
              <span class="pdc-currency-symbol">₹</span>
              <input type="number" id="pdc-edit-amount-input" class="form-control" value="${todayEntry.amount}" min="1" step="any" required>
            </div>
          </div>
          <div class="form-group mb-3">
            <label for="pdc-edit-place-input">Collection Place / Location *</label>
            <input type="text" id="pdc-edit-place-input" class="form-control" value="${this.escapeHtml(todayEntry.place)}" required>
          </div>
          <div class="pdc-active-actions">
            <button type="submit" id="pdc-save-edit-btn" class="btn primary-btn btn-md">
              💾 Save Changes
            </button>
            <button type="button" id="pdc-cancel-edit-btn" class="btn secondary-btn btn-md">
              ✖ Cancel
            </button>
          </div>
        </form>
      `;

      document.getElementById('pdc-cancel-edit-btn').addEventListener('click', () => {
        this.state.pdcStudentState.isEditing = false;
        this.renderStudentPdcEntryCard();
      });

      const editForm = document.getElementById('pdc-edit-entry-form');
      editForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const amtInput = document.getElementById('pdc-edit-amount-input');
        const placeInput = document.getElementById('pdc-edit-place-input');
        const saveBtn = document.getElementById('pdc-save-edit-btn');

        const amount = Number(amtInput.value);
        const place = placeInput.value.trim();

        if (isNaN(amount) || amount <= 0) {
          this.showToast('Amount must be greater than zero.', 'error');
          amtInput.focus();
          return;
        }
        if (!place) {
          this.showToast('Please mention the collection place.', 'error');
          placeInput.focus();
          return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        try {
          const res = await api.savePdcFundEntry({
            student_id: studentId,
            student_name: user.name || '',
            date: serverToday,
            amount: amount,
            place: place
          });

          if (res && res.success) {
            this.showToast('Fund entry updated successfully!', 'success');
            this.state.pdcStudentState.isEditing = false;
            await this.loadStudentPdcFundData(studentId);
          } else {
            this.showToast(res.message || res.error || 'Failed to update entry.', 'error');
          }
        } catch (err) {
          console.error(err);
          this.showToast(err.message || 'Network error updating entry.', 'error');
        } finally {
          if (saveBtn) saveBtn.disabled = false;
        }
      });

    } else {
      // State B: Active Entry View with Edit & Delete options
      const updatedTimeStr = todayEntry.updated_at ? this.formatIsoTimestamp(todayEntry.updated_at) : 'Today';
      const createdTimeStr = todayEntry.created_at ? this.formatIsoTimestamp(todayEntry.created_at) : 'Today';

      container.innerHTML = `
        <div class="pdc-active-card">
          <div class="pdc-entry-header">
            <div>
              <span class="badge-pill count-present" style="font-weight:700;">✅ Today's Active Entry</span>
              <h4 style="margin: 4px 0 0 0; color: #64748b; font-size: 0.85rem;">Date: ${formattedDate}</h4>
            </div>
            <span class="pdc-today-badge">🕒 Last Updated: ${updatedTimeStr}</span>
          </div>

          <div class="pdc-amount-hero">₹${Number(todayEntry.amount).toLocaleString('en-IN')}</div>
          
          <div class="pdc-active-meta">
            <div class="meta-item">
              <span>📍 Place:</span>
              <strong>${this.escapeHtml(todayEntry.place)}</strong>
            </div>
            <div class="meta-item">
              <span>⏱️ Submitted At:</span>
              <span>${createdTimeStr}</span>
            </div>
          </div>

          <div class="pdc-active-actions">
            <button type="button" id="pdc-edit-btn" class="btn outline-btn btn-sm">
              ✏️ Edit Entry
            </button>
            <button type="button" id="pdc-delete-btn" class="btn secondary-btn btn-sm" style="color: #dc2626; border-color: rgba(220, 38, 38, 0.3);">
              🗑️ Delete Entry
            </button>
          </div>
        </div>
      `;

      document.getElementById('pdc-edit-btn').addEventListener('click', () => {
        this.state.pdcStudentState.isEditing = true;
        this.renderStudentPdcEntryCard();
      });

      document.getElementById('pdc-delete-btn').addEventListener('click', () => {
        this.openDeletePdcConfirmModal(studentId, serverToday);
      });
    }
  },

  renderStudentPdcCalendar() {
    const records = this.state.pdcStudentState.records || [];
    const serverToday = this.state.pdcStudentState.serverToday || this.getLocalDateString();

    const recordMap = {};
    for (const r of records) {
      if (r.date) {
        recordMap[r.date] = r;
      }
    }

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const month = this.state.pdcStudentState.calendarMonth;
    const year = this.state.pdcStudentState.calendarYear;

    const monthYearEl = document.getElementById('pdc-mc-month-year');
    if (monthYearEl) {
      monthYearEl.textContent = `${monthNames[month]} ${year}`;
    }

    const grid = document.getElementById('pdc-mini-calendar-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < firstDay; i++) {
      const empty = document.createElement('div');
      empty.className = 'mc-day empty';
      grid.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dayCell = document.createElement('div');
      dayCell.className = 'mc-day';
      dayCell.textContent = day;

      const cellDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      const isToday = cellDateStr === serverToday;
      const isFuture = cellDateStr > serverToday;
      const hasFund = recordMap[cellDateStr] && Number(recordMap[cellDateStr].amount) > 0;
      const isSelected = cellDateStr === this.state.pdcStudentState.selectedCalendarDate;

      if (isToday) dayCell.classList.add('mc-today');
      if (hasFund) dayCell.classList.add('has-fund');
      if (isSelected) dayCell.classList.add('selected');

      if (isFuture) {
        dayCell.classList.add('future-day');
        dayCell.setAttribute('title', 'Future date — entry not permitted');
      } else {
        dayCell.addEventListener('click', () => {
          document.querySelectorAll('#pdc-mini-calendar-grid .mc-day').forEach(el => el.classList.remove('selected'));
          dayCell.classList.add('selected');
          this.state.pdcStudentState.selectedCalendarDate = cellDateStr;
          this.renderStudentPdcSelectedDateDetail(recordMap[cellDateStr], cellDateStr, isToday);
        });
      }

      grid.appendChild(dayCell);
    }

    const prevBtn = document.getElementById('pdc-mc-prev-month');
    const nextBtn = document.getElementById('pdc-mc-next-month');

    if (prevBtn) {
      prevBtn.onclick = () => {
        let m = this.state.pdcStudentState.calendarMonth - 1;
        let y = this.state.pdcStudentState.calendarYear;
        if (m < 0) { m = 11; y--; }
        this.state.pdcStudentState.calendarMonth = m;
        this.state.pdcStudentState.calendarYear = y;
        this.renderStudentPdcCalendar();
      };
    }

    if (nextBtn) {
      nextBtn.onclick = () => {
        let m = this.state.pdcStudentState.calendarMonth + 1;
        let y = this.state.pdcStudentState.calendarYear;
        if (m > 11) { m = 0; y++; }
        this.state.pdcStudentState.calendarMonth = m;
        this.state.pdcStudentState.calendarYear = y;
        this.renderStudentPdcCalendar();
      };
    }

    const selectedDate = this.state.pdcStudentState.selectedCalendarDate || serverToday;
    this.renderStudentPdcSelectedDateDetail(recordMap[selectedDate], selectedDate, selectedDate === serverToday);
  },

  renderStudentPdcSelectedDateDetail(entry, dateStr, isToday) {
    const container = document.getElementById('pdc-selected-date-detail');
    if (!container) return;

    const displayDate = new Date(dateStr);
    const dateFormatted = !isNaN(displayDate) 
      ? displayDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : dateStr;

    if (entry && Number(entry.amount) > 0) {
      const createdStr = entry.created_at ? this.formatIsoTimestamp(entry.created_at) : 'Recorded';
      const updatedStr = entry.updated_at ? this.formatIsoTimestamp(entry.updated_at) : createdStr;
      const readOnlyBadge = !isToday ? '<span class="badge-pill count-unmarked" style="font-size:0.75rem;">(View-Only Historical Record)</span>' : '';

      container.innerHTML = `
        <div class="pdc-date-detail-header">
          <div>
            <h4 style="margin: 0; font-size: 1rem; color: var(--primary-color);">📅 ${dateFormatted}</h4>
            ${readOnlyBadge}
          </div>
          <span class="badge-pill count-present" style="font-weight: 700;">✅ Submitted</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-top: 12px; flex-wrap:wrap; gap:10px;">
          <div>
            <span style="font-size: 0.82rem; color: #64748b; display:block;">Amount Collected</span>
            <span style="font-size: 1.6rem; font-weight: 700; color: #10b981; font-family:'Outfit', sans-serif;">₹${Number(entry.amount).toLocaleString('en-IN')}</span>
          </div>
          <div style="font-size: 0.88rem; color: #475569;">
            <span>📍 Place: <strong>${this.escapeHtml(entry.place)}</strong></span>
          </div>
        </div>
        <div class="pdc-modal-meta-list" style="margin-top: 12px; font-size: 0.8rem;">
          <div>⏱️ <strong>Submission Time:</strong> ${createdStr}</div>
          <div>🕒 <strong>Last Updated:</strong> ${updatedStr}</div>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="pdc-date-detail-header">
          <h4 style="margin: 0; font-size: 1rem; color: #64748b;">📅 ${dateFormatted}</h4>
          <span class="badge-pill count-unmarked">⚪ No Entry</span>
        </div>
        <p class="text-muted mb-0" style="font-size: 0.88rem; margin-top: 8px;">No fund collection was recorded on this date.</p>
      `;
    }
  },

  /**
   * Load Teacher/Admin PDC Fund Report
   */
  async loadTeacherPdcFundReport(date, isManualRefresh = false) {
    const tableBody = document.getElementById('pdc-admin-table-tbody');
    const refreshBtn = document.getElementById('pdc-admin-refresh-btn');
    const datePicker = document.getElementById('pdc-admin-date-picker');

    if (datePicker && date) {
      datePicker.value = date;
    }

    if (refreshBtn) {
      refreshBtn.disabled = true;
      const icon = refreshBtn.querySelector('.refresh-icon');
      if (icon) icon.style.display = 'inline-block';
    }

    if (!this.state.pdcAdminState.data && tableBody) {
      tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Fetching latest fund collections...</td></tr>';
    }

    try {
      const data = await api.getPdcFundDailyReport(date);
      if (data && data.success) {
        this.state.pdcAdminState.data = data;
        this.state.pdcAdminState.selectedDate = data.date;

        // Update Last Synced text
        const syncTimeEl = document.getElementById('pdc-admin-last-sync-time');
        if (syncTimeEl) {
          const now = new Date();
          syncTimeEl.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        }

        // Update Date Labels
        const dateLabelEl = document.getElementById('pdc-table-date-label');
        const subtextEl = document.getElementById('pdc-daily-date-subtext');
        const displayDate = new Date(data.date);
        const dateStr = !isNaN(displayDate) 
          ? displayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : data.date;

        if (dateLabelEl) dateLabelEl.textContent = dateStr;
        if (subtextEl) subtextEl.textContent = dateStr;

        // Render All-Time Banner
        const overallTotalEl = document.getElementById('pdc-overall-total-display');
        const overallContribEl = document.getElementById('pdc-overall-contributors-display');
        const overall = data.overall_summary || { overall_total: 0, overall_contributing_students_count: 0 };

        if (overallTotalEl) overallTotalEl.textContent = `₹${(overall.overall_total || 0).toLocaleString('en-IN')}`;
        if (overallContribEl) overallContribEl.textContent = `${overall.overall_contributing_students_count || 0} Students`;

        // Render 4 Daily Summary Cards
        const daily = data.daily_summary || { total_collected: 0, contributed_count: 0, total_students: 0, not_contributed_count: 0 };
        const dailyTotalEl = document.getElementById('pdc-daily-total-display');
        const dailyContribEl = document.getElementById('pdc-daily-contributed-count');
        const dailyTotalStudentsEl = document.getElementById('pdc-daily-total-students-count');
        const dailyNotContribEl = document.getElementById('pdc-daily-not-contributed-count');

        if (dailyTotalEl) dailyTotalEl.textContent = `₹${(daily.total_collected || 0).toLocaleString('en-IN')}`;
        if (dailyContribEl) dailyContribEl.textContent = daily.contributed_count || 0;
        if (dailyTotalStudentsEl) dailyTotalStudentsEl.textContent = daily.total_students || 0;
        if (dailyNotContribEl) dailyNotContribEl.textContent = daily.not_contributed_count || 0;

        // Render Leaderboard Table
        this.renderTeacherPdcLeaderboardTable(data.students || []);

        // Render Overall Student Rankings (all-time totals)
        this.renderOverallStudentRankings(data.students || []);

        if (isManualRefresh) {
          this.showToast('Fund collection table refreshed!', 'success');
        }
      }
    } catch (err) {
      console.error('[PDC Fund Report Error]', err);
      this.showToast(err.message || 'Failed to refresh table. Showing previously loaded records.', 'warning');
      if (!this.state.pdcAdminState.data && tableBody) {
        tableBody.innerHTML = `<tr><td colspan="5" class="text-center text-red py-4 font-bold">Failed to load: ${err.message}</td></tr>`;
      }
    } finally {
      if (refreshBtn) {
        refreshBtn.disabled = false;
      }
    }
  },

  renderTeacherPdcLeaderboardTable(students) {
    const tableBody = document.getElementById('pdc-admin-table-tbody');
    if (!tableBody) return;

    if (!students || students.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">No students found.</td></tr>';
      return;
    }

    tableBody.innerHTML = '';
    const isAmountVisible = this.state.pdcAdminState.columnVisibility.amount !== false;

    students.forEach(s => {
      const tr = document.createElement('tr');

      // Rank badge
      let rankHtml = '';
      if (s.rank === 1) rankHtml = '<span class="rank-badge rank-1" title="Rank 1"><span class="rank-icon">🥇</span><span>#1</span></span>';
      else if (s.rank === 2) rankHtml = '<span class="rank-badge rank-2" title="Rank 2"><span class="rank-icon">🥈</span><span>#2</span></span>';
      else if (s.rank === 3) rankHtml = '<span class="rank-badge rank-3" title="Rank 3"><span class="rank-icon">🥉</span><span>#3</span></span>';
      else if (s.rank === '-') rankHtml = '<span class="rank-badge rank-dash">-</span>';
      else rankHtml = `<span class="rank-badge rank-regular">#${s.rank}</span>`;

      // Status pill
      const isSubmitted = s.status === 'Submitted';
      const statusPill = isSubmitted
        ? '<span class="badge-pill count-present" style="font-weight:600;">Submitted</span>'
        : '<span class="badge-pill count-unmarked">Not Submitted</span>';

      // Amount
      let amountDisplay = '';
      if (isAmountVisible) {
        amountDisplay = isSubmitted ? `₹${Number(s.amount).toLocaleString('en-IN')}` : '₹0';
      } else {
        amountDisplay = '<span class="amount-masked">••••••</span>';
      }

      tr.innerHTML = `
        <td class="col-rank text-center">${rankHtml}</td>
        <td class="col-student-name">
          <span class="student-clickable-name" data-student-id="${s.student_id}" data-name="${this.escapeHtml(s.name)}" data-roll="${s.roll_no}" data-amount="${s.amount}" data-place="${this.escapeHtml(s.place || '')}">
            ${this.escapeHtml(s.name)}
          </span>
          <span class="text-muted" style="font-size:0.75rem; margin-left:4px;">(Roll ${s.roll_no})</span>
        </td>
        <td class="col-amount text-right col-pdc-amount" style="font-weight:700; color: ${isSubmitted ? '#10b981' : '#94a3b8'};">
          ${amountDisplay}
        </td>
        <td class="col-place col-pdc-place" style="font-size: 0.88rem; color: #475569;">
          ${this.escapeHtml(s.place || '-')}
        </td>
        <td class="col-status text-center col-pdc-status">
          ${statusPill}
        </td>
      `;

      // Attach click to open detail modal
      const nameEl = tr.querySelector('.student-clickable-name');
      if (nameEl) {
        nameEl.addEventListener('click', () => {
          this.openStudentPdcModal(
            s.student_id,
            s.name,
            s.roll_no,
            s.amount,
            s.place,
            s.created_at,
            s.updated_at,
            s.all_time_total
          );
        });
      }

      tableBody.appendChild(tr);
    });

    this.applyTeacherPdcColumnVisibility();
  },

  renderOverallStudentRankings(students) {
    const tbody = document.getElementById('pdc-total-collected-tbody') || document.getElementById('pdc-overall-ranking-tbody');
    if (!tbody) return;

    if (!students || students.length === 0) {
      tbody.innerHTML = '<tr><td colspan="2" class="text-center py-4 text-muted">No fund records found.</td></tr>';
      return;
    }

    // Sort students strictly by all_time_total descending
    const sorted = [...students].sort((a, b) => {
      const amtA = Number(a.all_time_total) || 0;
      const amtB = Number(b.all_time_total) || 0;
      if (amtB !== amtA) return amtB - amtA;
      return (Number(a.roll_no) || 0) - (Number(b.roll_no) || 0);
    });

    const isAmountVisible = this.state.pdcAdminState.columnVisibility.amount !== false;
    let html = '';

    sorted.forEach(s => {
      const total = Number(s.all_time_total) || 0;
      let totalDisplay = '';

      if (isAmountVisible) {
        totalDisplay = total > 0
          ? `<span style="font-weight:700; color:#10b981; font-size:1rem;">₹${total.toLocaleString('en-IN')}</span>`
          : '<span style="color:#94a3b8; font-weight:600;">₹0</span>';
      } else {
        totalDisplay = '<span class="amount-masked">••••••</span>';
      }

      html += `<tr>
        <td class="col-student-name" style="padding: 12px 16px;">
          <span class="student-clickable-name" data-student-id="${s.student_id}">
            ${this.escapeHtml(s.name || 'Unknown')}
          </span>
          <span class="text-muted" style="font-size:0.75rem; margin-left:6px;">(Roll ${s.roll_no || '-'})</span>
        </td>
        <td class="text-right col-pdc-total-amount" style="padding: 12px 16px;">
          ${totalDisplay}
        </td>
      </tr>`;
    });

    tbody.innerHTML = html;

    // Attach click listeners to student names
    tbody.querySelectorAll('.student-clickable-name').forEach(el => {
      el.addEventListener('click', () => {
        const studentId = el.getAttribute('data-student-id');
        const student = sorted.find(s => s.student_id === studentId);
        if (student) {
          this.openStudentPdcModal(
            student.student_id,
            student.name,
            student.roll_no,
            student.amount,
            student.place,
            student.created_at,
            student.updated_at,
            student.all_time_total
          );
        }
      });
    });
  },

  applyTeacherPdcColumnVisibility() {
    const vis = this.state.pdcAdminState.columnVisibility;

    // 1. Amount
    const toggleAmountBtn = document.getElementById('toggle-col-amount-btn');
    const toggleAmountState = document.getElementById('toggle-col-amount-state');
    const isAmountVisible = vis.amount !== false;

    if (toggleAmountBtn) {
      if (isAmountVisible) toggleAmountBtn.classList.add('active');
      else toggleAmountBtn.classList.remove('active');
    }
    if (toggleAmountState) {
      toggleAmountState.textContent = isAmountVisible ? 'Show' : 'Hide';
    }

    // Update table amount cells
    const data = this.state.pdcAdminState.data;
    if (data && data.students) {
      const amountCells = document.querySelectorAll('#pdc-admin-table-tbody td.col-pdc-amount');
      data.students.forEach((s, idx) => {
        const cell = amountCells[idx];
        if (cell) {
          if (isAmountVisible) {
            cell.innerHTML = s.status === 'Submitted' ? `₹${Number(s.amount).toLocaleString('en-IN')}` : '₹0';
          } else {
            cell.innerHTML = '<span class="amount-masked">••••••</span>';
          }
        }
      });
      // Also update total collected table
      const totalTbody = document.getElementById('pdc-total-collected-tbody') || document.getElementById('pdc-overall-ranking-tbody');
      if (totalTbody) {
        this.renderOverallStudentRankings(data.students);
      }
    }

    // 2. Place
    const togglePlaceBtn = document.getElementById('toggle-col-place-btn');
    const togglePlaceState = document.getElementById('toggle-col-place-state');
    const isPlaceVisible = vis.place !== false;

    if (togglePlaceBtn) {
      if (isPlaceVisible) togglePlaceBtn.classList.add('active');
      else togglePlaceBtn.classList.remove('active');
    }
    if (togglePlaceState) {
      togglePlaceState.textContent = isPlaceVisible ? 'Show' : 'Hide';
    }

    document.querySelectorAll('#pdc-admin-table .col-pdc-place').forEach(el => {
      el.style.display = isPlaceVisible ? '' : 'none';
    });

    // 3. Status
    const toggleStatusBtn = document.getElementById('toggle-col-status-btn');
    const toggleStatusState = document.getElementById('toggle-col-status-state');
    const isStatusVisible = vis.status !== false;

    if (toggleStatusBtn) {
      if (isStatusVisible) toggleStatusBtn.classList.add('active');
      else toggleStatusBtn.classList.remove('active');
    }
    if (toggleStatusState) {
      toggleStatusState.textContent = isStatusVisible ? 'Show' : 'Hide';
    }

    document.querySelectorAll('#pdc-admin-table .col-pdc-status').forEach(el => {
      el.style.display = isStatusVisible ? '' : 'none';
    });
  },

  async openStudentPdcModal(studentId, name, rollNo, dayAmount, dayPlace, createdAt, updatedAt, allTimeTotal) {
    const modal = document.getElementById('pdc-student-detail-modal');
    if (!modal) return;

    document.getElementById('pdc-modal-student-name').textContent = name || 'Student';
    document.getElementById('pdc-modal-student-roll').textContent = `Roll No: ${rollNo || '-'}`;

    const dayAmountEl = document.getElementById('pdc-modal-day-amount');
    const dayPlaceEl = document.getElementById('pdc-modal-day-place');
    if (dayAmountEl) dayAmountEl.textContent = `₹${(Number(dayAmount) || 0).toLocaleString('en-IN')}`;
    if (dayPlaceEl) dayPlaceEl.textContent = `Place: ${dayPlace || '-'}`;

    const allTimeEl = document.getElementById('pdc-modal-all-time');
    if (allTimeEl) allTimeEl.textContent = `₹${(Number(allTimeTotal) || 0).toLocaleString('en-IN')}`;

    const createdEl = document.getElementById('pdc-modal-created-at');
    const updatedEl = document.getElementById('pdc-modal-updated-at');
    if (createdEl) createdEl.textContent = createdAt ? this.formatIsoTimestamp(createdAt) : 'Not submitted today';
    if (updatedEl) updatedEl.textContent = updatedAt ? this.formatIsoTimestamp(updatedAt) : '-';

    const historyContainer = document.getElementById('pdc-modal-history-list');
    if (historyContainer) {
      historyContainer.innerHTML = '<p class="text-center py-3 text-muted">Loading collection history...</p>';
    }

    modal.classList.remove('hidden');

    try {
      const historyData = await api.getPdcFundStudentHistory(studentId);
      if (historyData && historyData.success && historyContainer) {
        const records = historyData.records || [];
        if (records.length === 0) {
          historyContainer.innerHTML = '<p class="text-center py-3 text-muted">No historical collections found.</p>';
        } else {
          historyContainer.innerHTML = '';
          records.forEach(r => {
            const item = document.createElement('div');
            item.className = 'pdc-modal-history-item';
            const displayDate = new Date(r.date);
            const dateStr = !isNaN(displayDate) 
              ? displayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : r.date;

            item.innerHTML = `
              <div>
                <strong>${dateStr}</strong>
                <span class="text-muted" style="font-size:0.8rem; margin-left:6px;">📍 ${this.escapeHtml(r.place || 'Campus')}</span>
              </div>
              <strong style="color:#10b981;">₹${Number(r.amount).toLocaleString('en-IN')}</strong>
            `;
            historyContainer.appendChild(item);
          });
        }
      }
    } catch (e) {
      if (historyContainer) {
        historyContainer.innerHTML = '<p class="text-center py-3 text-muted">History loaded from daily record.</p>';
      }
    }
  },

  /**
   * Open custom themed confirmation popup for deleting an active PDC Fund entry
   */
  openDeletePdcConfirmModal(studentId, date) {
    const modal = document.getElementById('pdc-delete-confirm-modal');
    if (!modal) return;

    const cancelBtn = document.getElementById('pdc-modal-cancel-delete');
    const confirmBtn = document.getElementById('pdc-modal-confirm-delete');

    // Clone buttons to strip any prior listeners
    const newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

    const closeModal = () => {
      modal.classList.add('hidden');
      window.removeEventListener('keydown', handleKeyDown);
      modal.removeEventListener('click', handleOverlayClick);
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') closeModal();
    };

    const handleOverlayClick = (e) => {
      if (e.target === modal) closeModal();
    };

    newCancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', handleOverlayClick);
    window.addEventListener('keydown', handleKeyDown);

    newConfirmBtn.addEventListener('click', async () => {
      newConfirmBtn.disabled = true;
      newConfirmBtn.textContent = 'Deleting...';
      newCancelBtn.disabled = true;

      try {
        const res = await api.deletePdcFundEntry({
          student_id: studentId,
          date: date
        });

        if (res && res.success) {
          closeModal();
          this.showToast('Fund entry deleted. You can now submit a replacement entry.', 'success');
          await this.loadStudentPdcFundData(studentId);
        } else {
          this.showToast(res.message || res.error || 'Failed to delete fund entry.', 'error');
          newConfirmBtn.disabled = false;
          newConfirmBtn.innerHTML = '🗑️ Yes, Delete';
          newCancelBtn.disabled = false;
        }
      } catch (err) {
        console.error(err);
        this.showToast(err.message || 'Error deleting entry.', 'error');
        newConfirmBtn.disabled = false;
        newConfirmBtn.innerHTML = '🗑️ Yes, Delete';
        newCancelBtn.disabled = false;
      }
    });

    modal.classList.remove('hidden');
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
