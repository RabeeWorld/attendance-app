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
   * 1. Validate PIN login against server
   */
  async login(pin) {
    return this._get('login', { pin });
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
  }
};
