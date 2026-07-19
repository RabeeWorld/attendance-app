/**
 * ============================================================================
 * CONFIGURATION SETTINGS (config.js)
 * ============================================================================
 * 
 * Instructions:
 * 1. Deploy your Google Apps Script (`Code.gs`) as a Web App ("Execute as Me", "Anyone").
 * 2. Copy the generated Web App URL and paste it into `API_BASE_URL` below.
 * 3. Ensure `API_TOKEN` matches the `api_token` value set in your Google Sheet's `Config` tab.
 * ============================================================================
 */

window.CONFIG = {
  // Replace this placeholder URL with your actual deployed Google Apps Script Web App URL
  API_BASE_URL: 'https://script.google.com/macros/s/AKfycbywUUTmfrqEGXOzNRZBhlis7XAicWdFu70jRSI_PzGmMu-AboCM_8F8e_e6vB_8DCGA/exec',

  // Shared secret token matching `Config.api_token` in your Google Sheet
  API_TOKEN: 'SLAQ_SECRET_2026',

  // Default PIN for initial local testing if needed
  DEFAULT_PIN: '1234'
};

// Global shorthand variables for easy access across scripts
const API_BASE_URL = window.CONFIG.API_BASE_URL;
const API_TOKEN = window.CONFIG.API_TOKEN;
