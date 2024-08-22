const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Create a write stream for logging
const logStream = fs.createWriteStream('server_logs.txt', { flags: 'a' });

// Helper function to log messages to both console and file
function logMessage(message) {
  console.log(message);
  logStream.write(`${message}\n`);
}

function getSheetNameForDate(date, sheetNames) {
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayIndex = new Date(date).getUTCDay();
    const dayName = daysOfWeek[dayIndex];
    return sheetNames.find(name => name.toLowerCase().includes(dayName.toLowerCase()));
  }

app.use(cors());
app.use(express.static('public'));
app.use(express.json());

let serviceAccount;
try {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS environment variable is not set');
  }
  
  const credentialsPath = path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  
  if (!fs.existsSync(credentialsPath)) {
    throw new Error(`The file specified by GOOGLE_APPLICATION_CREDENTIALS does not exist: ${credentialsPath}`);
  }
  
  serviceAccount = require(credentialsPath);
} catch (error) {
  logMessage(`Error loading service account credentials: ${error.message}`);
  process.exit(1);
}

const jwtClient = new google.auth.JWT(
  serviceAccount.client_email,
  null,
  serviceAccount.private_key,
  ['https://www.googleapis.com/auth/spreadsheets']
);

const sheets = google.sheets({ version: 'v4', auth: jwtClient });

app.get('/api/sheet-data', async (req, res) => {
    try {
      const response = await sheets.spreadsheets.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        includeGridData: true
      });
      
      // Log the raw response
      logMessage('Raw Google Sheets response: ' + JSON.stringify(response.data, null, 2));
  
      const processedData = response.data.sheets.map(sheet => ({
        name: sheet.properties.title,
        data: sheet.data[0].rowData.map(row => 
          row.values ? row.values.map(cell => cell.formattedValue) : []
        )
      }));
  
      logMessage('Processed sheet data: ' + JSON.stringify(processedData, null, 2));
  
      res.json(processedData);
    } catch (error) {
      logMessage('Error fetching sheet data: ' + error);
      res.status(500).json({ error: 'Failed to fetch sheet data' });
    }
  });

app.get('/api/sheet-data/:sheetName', async (req, res) => {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: req.params.sheetName
    });
    res.json(response.data);
  } catch (error) {
    logMessage(`Error fetching sheet data for ${req.params.sheetName}: ${error}`);
    res.status(500).json({ error: `Failed to fetch sheet data for ${req.params.sheetName}` });
  }
});


app.post('/api/update-sheet', async (req, res) => {
    try {
      const { values } = req.body;
      console.log('Received values to update:', values);
  
      // Fetch all sheet names first
      const sheetsResponse = await sheets.spreadsheets.get({
        spreadsheetId: process.env.SPREADSHEET_ID
      });
      
      const sheetNames = sheetsResponse.data.sheets.map(sheet => sheet.properties.title);
      console.log('Available sheets:', sheetNames);
  
      const results = [];
  
      for (const [date, role, flag, nameAndPhone] of values) {
        const sheetName = getSheetNameForDate(date, sheetNames);
        
        if (!sheetName) {
          results.push({ date, status: 'skipped', reason: `No sheet found for date ${date}` });
          continue;
        }
  
        try {
          // Get the data for the specific day's sheet
          const sheetData = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: `${sheetName}!A1:Z`
          });
  
          const rows = sheetData.data.values;
          if (!rows) {
            results.push({ date, status: 'error', reason: `No data found in sheet ${sheetName}` });
            continue;
          }
  
          // Find the column for the date
          const dateRow = rows[1];
          const dateColumn = dateRow.findIndex(cell => cell === date);
          if (dateColumn === -1) {
            results.push({ date, status: 'error', reason: `Date ${date} not found in sheet ${sheetName}` });
            continue;
          }
  
          // Find the row for the role
          let roleRow = -1;
          for (let i = 2; i < rows.length; i++) {
            if (rows[i][0] && rows[i][0].replace(/\s*#\d+/, '') === role) {
              if (!rows[i][dateColumn] || rows[i][dateColumn] === 'false') {
                roleRow = i;
                break;
              }
            }
          }
  
          if (roleRow === -1) {
            results.push({ date, status: 'error', reason: `No available slot for ${role} on ${date} in sheet ${sheetName}` });
            continue;
          }
  
          // Update the cell
          await sheets.spreadsheets.values.update({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: `${sheetName}!${String.fromCharCode(65 + dateColumn)}${roleRow + 1}`,
            valueInputOption: 'USER_ENTERED',
            resource: {
              values: [[nameAndPhone]]
            }
          });
  
          results.push({ date, status: 'success' });
        } catch (error) {
          results.push({ date, status: 'error', reason: error.message });
        }
      }
  
      res.json({ success: true, message: 'Operation completed', results });
    } catch (error) {
      console.error('Error updating sheet:', error);
      res.status(500).json({ error: 'Failed to update sheet', details: error.message, stack: error.stack });
    }
  });

app.get('/api/secrets', (req, res) => {
  res.json({
    SPREADSHEET_ID: process.env.SPREADSHEET_ID,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function columnToLetter(column) {
    let temp, letter = '';
    while (column > 0) {
        temp = (column - 1) % 26;
        letter = String.fromCharCode(temp + 65) + letter;
        column = (column - temp - 1) / 26;
    }
    return letter;
}

app.listen(port, () => {
  logMessage(`Server running on http://localhost:${port}`);
});
