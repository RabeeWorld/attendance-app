/**
 * ============================================================================
 * API COMMUNICATION WRAPPER (api.js)
 * ============================================================================
 * 
 * Handles all fetch() requests to the Google Apps Script Web App.
 * Includes CORS optimization and detailed network error identification so the
 * app can gracefully transition to offline IndexedDB storage when offline.
 * ============================================================================
 */

const api = {
  /**
   * Helper to construct complete endpoint URL with query parameters and auth token
   */
  _buildUrl(action, extraParams = {}) {
    const baseUrl = window.CONFIG.API_BASE_URL;
    const token = window.CONFIG.API_TOKEN;
    
    // Check if user forgot to replace the placeholder URL
    if (!baseUrl || baseUrl.includes('YOUR_DEPLOYED_WEB_APP_ID_HERE')) {
      console.warn('[API Warning] API_BASE_URL is still set to the placeholder in config.js.');
    }

    const url = new URL(baseUrl);
    url.searchParams.append('action', action);
    url.searchParams.append('token', token);
    
    for (const [key, value] of Object.entries(extraParams)) {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value);
      }
    }
    return url.toString();
  },

  /**
   * Internal GET request wrapper with error handling
   */
  async _get(action, params = {}) {
    if (!navigator.onLine) {
      const offlineError = new Error('No internet connection.');
      offlineError.isNetworkError = true;
      throw offlineError;
    }

    const url = this._buildUrl(action, params);
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow'
      });
      
      if (!response.ok) {
        throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      if (!data.success && data.error === 'unauthorized') {
        throw new Error('Unauthorized: Invalid API Token in config.js.');
      }
      return data;
    } catch (error) {
      if (error.name === 'TypeError' || !navigator.onLine || error.message.includes('Failed to fetch') || error.isNetworkError) {
        error.isNetworkError = true;
        error.message = 'Network error: Could not connect to Google Sheets server.';
      }
      throw error;
    }
  },

  /**
   * Internal POST request wrapper with CORS optimization
   */
  async _post(action, payload = {}) {
    if (!navigator.onLine) {
      const offlineError = new Error('No internet connection.');
      offlineError.isNetworkError = true;
      throw offlineError;
    }

    // Include action and token in URL parameters as fallback for Apps Script
    const url = this._buildUrl(action);
    // Ensure token is attached inside body too
    const fullPayload = {
      ...payload,
      action: action,
      token: window.CONFIG.API_TOKEN
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        // Using 'text/plain;charset=utf-8' prevents CORS preflight OPTIONS errors with Google Apps Script
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify(fullPayload)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      if (!data.success && data.error === 'unauthorized') {
        throw new Error('Unauthorized: Invalid API Token in config.js.');
      }
      return data;
    } catch (error) {
      if (error.name === 'TypeError' || !navigator.onLine || error.message.includes('Failed to fetch') || error.isNetworkError) {
        error.isNetworkError = true;
        error.message = 'Network error: Could not submit attendance to Google Sheets server.';
      }
      throw error;
    }
  },

  /* ============================================================================
   * PUBLIC API METHODS
   * ============================================================================ */

  /**
   * 1. Validate Username/PIN login against server
   */
  async login(username, pin) {
    return this._get('login', { username, pin });
  },

  /**
   * 2. Fetch all student batches (B1, B2) with offline cache fallback
   */
  async getBatches() {
    if (!navigator.onLine) {
      try {
        const cached = JSON.parse(localStorage.getItem('slaq_batches_cache') || '[]');
        if (Array.isArray(cached) && cached.length > 0) {
          return { success: true, batches: cached, fromCache: true };
        }
      } catch (e) {}
    }
    try {
      return await this._get('getBatches');
    } catch (error) {
      try {
        const cached = JSON.parse(localStorage.getItem('slaq_batches_cache') || '[]');
        if (Array.isArray(cached) && cached.length > 0) {
          return { success: true, batches: cached, fromCache: true };
        }
      } catch (e) {}
      throw error;
    }
  },

  /**
   * 2.5 Fetch all core setup data in 1 single network request (Batches, Subjects B1/B2, Students B1/B2)
   */
  async getBootstrapData() {
    return this._get('getBootstrapData');
  },

  /**
   * 3. Fetch active students in a batch sorted by roll_no (with offline cache fallback)
   */
  async getStudents(batchId) {
    // LOCAL DEV MOCK: If PRAYERS and backend not updated yet, pull from local cache
    if (batchId === 'PRAYERS') {
      try {
        const cached = JSON.parse(localStorage.getItem('slaq_students_cache') || '{}');
        if (cached && cached['PRAYERS'] && cached['PRAYERS'].length > 0) {
          return { success: true, batch_id: batchId, students: cached['PRAYERS'], fromCache: true, isMock: true };
        } else if (cached && cached['CAMPUS'] && cached['CAMPUS'].length > 0) {
          return { success: true, batch_id: batchId, students: cached['CAMPUS'], fromCache: true, isMock: true };
        }
      } catch (e) {}
    }

    if (!navigator.onLine) {
      try {
        const cached = JSON.parse(localStorage.getItem('slaq_students_cache') || '{}');
        if (cached && cached[batchId]) {
          return { success: true, batch_id: batchId, students: cached[batchId], fromCache: true };
        }
      } catch (e) {}
    }
    try {
      return await this._get('getStudents', { batch_id: batchId });
    } catch (error) {
      try {
        const cached = JSON.parse(localStorage.getItem('slaq_students_cache') || '{}');
        if (cached && cached[batchId]) {
          return { success: true, batch_id: batchId, students: cached[batchId], fromCache: true };
        }
      } catch (e) {}
      throw error;
    }
  },

  /**
   * 4. Fetch available subjects for a batch (with offline cache fallback)
   */
  async getSubjects(batchId) {
    if (!navigator.onLine) {
      try {
        const cached = JSON.parse(localStorage.getItem('slaq_subjects_cache') || '{}');
        if (cached && cached[batchId]) {
          return { success: true, batch_id: batchId, subjects: cached[batchId], fromCache: true };
        }
      } catch (e) {}
    }
    try {
      return await this._get('getSubjects', { batch_id: batchId });
    } catch (error) {
      try {
        const cached = JSON.parse(localStorage.getItem('slaq_subjects_cache') || '{}');
        if (cached && cached[batchId]) {
          return { success: true, batch_id: batchId, subjects: cached[batchId], fromCache: true };
        }
      } catch (e) {}
      throw error;
    }
  },

  /**
   * 5. Fetch existing attendance records for a specific date, batch, and subject
   */
  async getAttendance(date, batchId, subjectId) {
    return this._get('getAttendance', {
      date: date,
      batch_id: batchId,
      subject_id: subjectId
    });
  },

  /**
   * 6. Submit attendance payload (or sync offline payload)
   * Payload: { date, batch_id, subject_id, teacher, records: [{student_id, status}] }
   */
  async submitAttendance(payload) {
    return this._post('submitAttendance', payload);
  },

  /**
   * 7. Fetch report summary and history for an individual student (with offline cache fallback)
   */
  async getReport(studentId) {
    if (!navigator.onLine) {
      try {
        const cached = JSON.parse(localStorage.getItem('slaq_student_reports_cache') || '{}');
        if (cached && cached[studentId]) {
          return { success: true, ...cached[studentId], fromCache: true };
        }
      } catch (e) {}
    }
    try {
      const data = await this._get('getReport', { student_id: studentId });
      if (data && data.success) {
        try {
          const cached = JSON.parse(localStorage.getItem('slaq_student_reports_cache') || '{}');
          cached[studentId] = data;
          localStorage.setItem('slaq_student_reports_cache', JSON.stringify(cached));
        } catch (e) {}
      }
      return data;
    } catch (error) {
      try {
        const cached = JSON.parse(localStorage.getItem('slaq_student_reports_cache') || '{}');
        if (cached && cached[studentId]) {
          return { success: true, ...cached[studentId], fromCache: true };
        }
      } catch (e) {}
      throw error;
    }
  },

  /**
   * 8. Fetch subject aggregate report across all students (with offline cache fallback)
   */
  async getSubjectReport(subjectId) {
    if (!navigator.onLine) {
      try {
        const cached = JSON.parse(localStorage.getItem('slaq_subject_reports_cache') || '{}');
        if (cached && cached[subjectId]) {
          return { success: true, ...cached[subjectId], fromCache: true };
        }
      } catch (e) {}
    }
    try {
      const data = await this._get('getSubjectReport', { subject_id: subjectId });
      if (data && data.success) {
        try {
          const cached = JSON.parse(localStorage.getItem('slaq_subject_reports_cache') || '{}');
          cached[subjectId] = data;
          localStorage.setItem('slaq_subject_reports_cache', JSON.stringify(cached));
        } catch (e) {}
      }
      return data;
    } catch (error) {
      try {
        const cached = JSON.parse(localStorage.getItem('slaq_subject_reports_cache') || '{}');
        if (cached && cached[subjectId]) {
          return { success: true, ...cached[subjectId], fromCache: true };
        }
      } catch (e) {}
      throw error;
    }
  },

  /**
   * 9. Fetch prayers report for a specific date (with offline cache fallback)
   */
  async getPrayersReport(date) {
    if (!navigator.onLine) {
      try {
        const cached = JSON.parse(localStorage.getItem('slaq_prayers_reports_cache') || '{}');
        if (cached && cached[date]) {
          return { success: true, ...cached[date], fromCache: true };
        }
      } catch (e) {}
    }
    try {
      const data = await this._get('getPrayersReport', { date: date });
      if (data && data.success) {
        try {
          const cached = JSON.parse(localStorage.getItem('slaq_prayers_reports_cache') || '{}');
          cached[date] = data;
          localStorage.setItem('slaq_prayers_reports_cache', JSON.stringify(cached));
        } catch (e) {}
        return data;
      } else {
        // Trigger the fallback mock generator if the live server doesn't support this yet
        throw new Error(data.error || "Server failed");
      }
    } catch (error) {
      console.warn("Server failed to generate prayers report, generating local mock for dev mode.");
      try {
        const cachedStudents = JSON.parse(localStorage.getItem('slaq_students_cache') || '{}');
        const studentsList = cachedStudents['PRAYERS'] || cachedStudents['CAMPUS'] || [];
        
        const statsByStudent = {};
        studentsList.forEach(s => {
          statsByStudent[s.student_id] = {
            student_id: s.student_id,
            name: s.name,
            roll_no: s.roll_no,
            batch_id: s.batch_id,
            attendance: {}
          };
        });

        let totalPrayersMarked = 0;
        let totalPrayersAttended = 0;

        const prefix = `slaq_att_${date}_PRAYERS_`;
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(prefix)) {
            const subId = key.replace(prefix, '');
            const snapshot = JSON.parse(localStorage.getItem(key) || 'null');
            if (snapshot) {
              Object.keys(snapshot).forEach(sid => {
                if (statsByStudent[sid]) {
                  const status = snapshot[sid];
                  statsByStudent[sid].attendance[subId] = status;
                  totalPrayersMarked++;
                  if (status === 'Present') totalPrayersAttended++;
                }
              });
            }
          }
        }

        const studentStatsArray = Object.values(statsByStudent);
        studentStatsArray.sort((a, b) => {
          if (a.batch_id < b.batch_id) return -1;
          if (a.batch_id > b.batch_id) return 1;
          return Number(a.roll_no) - Number(b.roll_no);
        });

        const data = {
          success: true,
          date: date,
          students: studentStatsArray,
          summary: {
            total_students: studentStatsArray.length,
            total_prayers_marked: totalPrayersMarked,
            total_prayers_attended: totalPrayersAttended
          },
          isMock: true
        };
        const cachedReps = JSON.parse(localStorage.getItem('slaq_prayers_reports_cache') || '{}');
        cachedReps[date] = data;
        localStorage.setItem('slaq_prayers_reports_cache', JSON.stringify(cachedReps));
        return data;
      } catch (e) {
        console.error("Local mock failed", e);
      }
      try {
        const cached = JSON.parse(localStorage.getItem('slaq_prayers_reports_cache') || '{}');
        if (cached && cached[date]) {
          return { success: true, ...cached[date], fromCache: true };
        }
      } catch (e) {}
      throw error;
    }
  },

  /**
   * 10. Fetch prayers overall defaulters report
   * Tries server first. If offline/error, falls back to local scan.
   */
  async getPrayersOverallReport() {
    if (navigator.onLine) {
      try {
        const data = await this._get('getPrayersOverallReport', {});
        if (data && data.success) {
          return data;
        }
      } catch (error) {
        console.warn("Server failed to generate overall report, generating local mock for dev mode.");
      }
    }

    // Offline / Fallback local scan
    return new Promise((resolve) => {
      try {
        const cachedStudents = JSON.parse(localStorage.getItem('slaq_students_cache') || '{}');
        const studentsList = cachedStudents['PRAYERS'] || cachedStudents['CAMPUS'] || [];
        
        const statsByStudent = {};
        studentsList.forEach(s => {
          statsByStudent[s.student_id] = {
            student_id: s.student_id,
            name: s.name,
            roll_no: s.roll_no,
            missed_counts: {},
            total_missed: 0
          };
        });

        // Scan localStorage for all attendance keys related to PRAYERS
        const prefixMatch = /^slaq_att_(.*?)_PRAYERS_/;
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && prefixMatch.test(key)) {
            const match = prefixMatch.exec(key);
            const dateStr = match[1];
            const subId = key.replace(`slaq_att_${dateStr}_PRAYERS_`, '');
            
            const snapshot = JSON.parse(localStorage.getItem(key) || 'null');
            if (snapshot) {
              Object.keys(snapshot).forEach(sid => {
                if (statsByStudent[sid]) {
                  const status = snapshot[sid];
                  if (status === 'Absent') {
                    if (!statsByStudent[sid].missed_counts[subId]) {
                      statsByStudent[sid].missed_counts[subId] = 0;
                    }
                    statsByStudent[sid].missed_counts[subId]++;
                    statsByStudent[sid].total_missed++;
                  }
                }
              });
            }
          }
        }

        const studentStatsArray = Object.values(statsByStudent);
        // Sort by total_missed descending
        studentStatsArray.sort((a, b) => b.total_missed - a.total_missed);

        resolve({
          success: true,
          students: studentStatsArray,
          summary: {
            total_students: studentStatsArray.length
          },
          isMock: true
        });
      } catch (e) {
        console.error("Local mock for overall report failed", e);
        resolve({ success: false, error: e.message });
      }
    });
  }
};
