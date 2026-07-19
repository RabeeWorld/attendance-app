/**
 * ============================================================================
 * INDEXEDDB OFFLINE QUEUE (db.js)
 * ============================================================================
 * 
 * Manages local IndexedDB storage (`attendance_db`) for saving attendance payloads
 * locally when network requests fail (`pendingSync` store with auto-increment ID).
 * Automatically listens to online events to flush queued records to Google Sheets.
 * ============================================================================
 */

const db = {
  DB_NAME: 'attendance_db',
  DB_VERSION: 1,
  STORE_NAME: 'pendingSync',
  _dbInstance: null,
  _statusListeners: [],

  /**
   * Open and initialize the IndexedDB instance
   */
  async open() {
    if (this._dbInstance) return this._dbInstance;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = (event) => {
        console.error('[IndexedDB Error] Failed to open database:', event.target.error);
        reject(event.target.error);
      };

      request.onsuccess = (event) => {
        this._dbInstance = event.target.result;
        resolve(this._dbInstance);
      };

      request.onupgradeneeded = (event) => {
        const database = event.target.result;
        if (!database.objectStoreNames.contains(this.STORE_NAME)) {
          database.createObjectStore(this.STORE_NAME, { keyPath: 'id', autoIncrement: true });
          console.log(`[IndexedDB] Created object store: ${this.STORE_NAME}`);
        }
      };
    });
  },

  /**
   * Queue a submitAttendance payload when network write fails
   */
  async queueAttendance(payload) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([this.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      
      const item = {
        payload: payload,
        queued_at: new Date().toISOString()
      };

      const request = store.add(item);

      request.onsuccess = () => {
        console.log('[Offline Queue] Saved attendance record to IndexedDB:', request.result);
        this.notifyListeners();
        resolve(request.result);
      };

      request.onerror = (event) => {
        console.error('[Offline Queue Error] Could not save to IndexedDB:', event.target.error);
        reject(event.target.error);
      };
    });
  },

  /**
   * Get all pending attendance payloads queued inside IndexedDB
   */
  async getPendingSync() {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([this.STORE_NAME], 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = (event) => {
        console.error('[Offline Queue Error] Could not retrieve pending items:', event.target.error);
        reject(event.target.error);
      };
    });
  },

  /**
   * Get count of pending items for UI sync indicator
   */
  async getPendingCount() {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([this.STORE_NAME], 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.count();

      request.onsuccess = () => {
        resolve(request.result || 0);
      };

      request.onerror = (event) => {
        resolve(0);
      };
    });
  },

  /**
   * Remove a successfully synced item from the queue
   */
  async removePending(id) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([this.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => {
        console.log(`[Offline Queue] Removed synced item ID: ${id}`);
        this.notifyListeners();
        resolve();
      };

      request.onerror = (event) => {
        console.error(`[Offline Queue Error] Could not delete item ID ${id}:`, event.target.error);
        reject(event.target.error);
      };
    });
  },

  /**
   * Attempt to sync all queued items with the Google Apps Script Web App
   */
  async syncPendingAttendance() {
    if (!navigator.onLine) {
      console.log('[Offline Queue Sync] Currently offline. Skipping sync attempt.');
      return { synced: 0, failed: 0 };
    }

    const pendingItems = await this.getPendingSync();
    if (pendingItems.length === 0) {
      this.notifyListeners();
      return { synced: 0, failed: 0 };
    }

    console.log(`[Offline Queue Sync] Starting sync for ${pendingItems.length} queued records...`);
    let syncedCount = 0;
    let failedCount = 0;

    for (const item of pendingItems) {
      try {
        const result = await api.submitAttendance(item.payload);
        if (result && result.success) {
          await this.removePending(item.id);
          syncedCount++;
        } else {
          console.warn(`[Offline Queue Sync] Server rejected item ID ${item.id}:`, result);
          failedCount++;
        }
      } catch (error) {
        console.error(`[Offline Queue Sync] Failed to sync item ID ${item.id}:`, error);
        failedCount++;
      }
    }

    this.notifyListeners();
    return { synced: syncedCount, failed: failedCount };
  },

  /**
   * Register listener function to update UI when pending count changes
   */
  onSyncStatusChange(callback) {
    if (typeof callback === 'function') {
      this._statusListeners.push(callback);
    }
  },

  /**
   * Notify all listeners of current queue count
   */
  async notifyListeners() {
    try {
      const count = await this.getPendingCount();
      for (const listener of this._statusListeners) {
        listener(count);
      }
    } catch (e) {
      console.error('[Offline Queue] Error notifying listeners:', e);
    }
  }
};

/**
 * Setup global event listeners for automatic synchronization on load and online event
 */
window.addEventListener('online', async () => {
  console.log('[Network Status] Reconnected to network. Triggering automatic sync...');
  await db.syncPendingAttendance();
});

window.addEventListener('DOMContentLoaded', async () => {
  await db.open();
  await db.notifyListeners();
  if (navigator.onLine) {
    await db.syncPendingAttendance();
  }
});
