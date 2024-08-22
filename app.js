// Google Sheets API configuration
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const API_KEY = process.env.API_KEY;
const CLIENT_ID = process.env.CLIENT_ID;
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

let availableSlots = {};
let calendar;
let isAdminLoggedIn = false;
let availableDays = [];

document.addEventListener('DOMContentLoaded', () => {
    initializeCalendar();
    setupEventListeners();
    gapi.load('client:auth2', initClient);
});

function initializeCalendar() {
    const calendarEl = document.getElementById('calendar');
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        selectable: true,
        selectConstraint: {
            daysOfWeek: [0, 1, 2, 3, 4, 5, 6] // Allow selection on all days initially
        },
        select: function(info) {
            handleDateSelection(info.start);
        },
        dayCellDidMount: function(info) {
            // Initially, don't disable any days
            // This will be updated once we load the sheet data
        }
    });
    calendar.render();
}

function initClient() {
    gapi.client.init({
        apiKey: API_KEY,
        clientId: CLIENT_ID,
        scope: SCOPE
    }).then(() => {
        loadAllSheetData();
    });
}

async function loadAllSheetData() {
    try {
        const response = await gapi.client.sheets.spreadsheets.get({
            spreadsheetId: SPREADSHEET_ID,
            includeGridData: true
        });

        const sheets = response.result.sheets;
        availableSlots = {};
        availableDays = [];

        for (const sheet of sheets) {
            const sheetName = sheet.properties.title;
            const dayIndex = getDayOfWeekFromSheetName(sheetName);
            if (dayIndex !== -1) {
                availableDays.push(dayIndex);
            }
            const sheetData = sheet.data[0].rowData.map(row => 
                row.values ? row.values.map(cell => cell.formattedValue) : []
            );
            availableSlots[sheetName] = processSheetData(sheetData);
        }

        updateRoleDropdown();
        updateCalendar();
        updateCalendarConstraints();
    } catch (error) {
        console.error('Error loading sheet data:', error);
    }
}

function getDayOfWeekFromSheetName(sheetName) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return days.indexOf(sheetName.toLowerCase());
}

function updateCalendarConstraints() {
    calendar.setOption('selectConstraint', {
        daysOfWeek: availableDays
    });

    calendar.setOption('dayCellDidMount', function(info) {
        if (!availableDays.includes(info.date.getDay())) {
            info.el.classList.add('fc-day-disabled');
        }
    });

    calendar.refetchEvents();
}

function processSheetData(data) {
    const weekNumbers = data[0][0].split(',').map(num => parseInt(num.trim()));
    const roles = data.slice(1).map(row => row[0]).filter(role => role);
    const dates = data[0].slice(1);
    
    const availability = {};
    dates.forEach((date, index) => {
        availability[date] = {};
        roles.forEach((role, roleIndex) => {
            const genericRole = role.replace(/\s*#\d+/, '');
            if (!availability[date][genericRole]) {
                availability[date][genericRole] = {
                    total: roles.filter(r => r.replace(/\s*#\d+/, '') === genericRole).length,
                    available: roles.filter(r => r.replace(/\s*#\d+/, '') === genericRole).length
                };
            }
            if (data[roleIndex + 1][index + 1]) {
                availability[date][genericRole].available--;
            }
        });
    });

    return {
        weekNumbers,
        availability
    };
}

function updateRoleDropdown() {
    const roleSelect = document.getElementById('role');
    const currentOptions = Array.from(roleSelect.options).map(option => option.value);
    
    const allRoles = new Set();
    Object.values(availableSlots).forEach(dayData => {
        Object.keys(dayData.availability[Object.keys(dayData.availability)[0]]).forEach(role => allRoles.add(role));
    });

    Array.from(allRoles).sort().forEach(role => {
        if (!currentOptions.includes(role)) {
            const option = document.createElement('option');
            option.value = role;
            option.textContent = role;
            roleSelect.appendChild(option);
        }
    });

    currentOptions.forEach(option => {
        if (option !== "" && !allRoles.has(option)) {
            roleSelect.querySelector(`option[value="${option}"]`).remove();
        }
    });
}

function updateCalendar() {
    const role = document.getElementById('role').value;
    calendar.removeAllEventSources();

    if (role) {
        const events = [];
        Object.entries(availableSlots).forEach(([dayOfWeek, dayData]) => {
            Object.entries(dayData.availability).forEach(([date, roles]) => {
                if (roles[role]) {
                    events.push({
                        start: date,
                        display: 'background',
                        color: roles[role].available > 0 ? '#e0f7fa' : '#ffcdd2'
                    });
                }
            });
        });

        calendar.addEventSource(events);
    }

    updateCalendarConstraints();
    calendar.refetchEvents();
}

function handleDateSelection(date) {
    const dateString = date.toISOString().split('T')[0];
    const dayOfWeek = date.toLocaleString('en-us', {weekday: 'long'});
    const role = document.getElementById('role').value;

    if (availableSlots[dayOfWeek] && 
        availableSlots[dayOfWeek].availability[dateString] && 
        availableSlots[dayOfWeek].availability[dateString][role] &&
        availableSlots[dayOfWeek].availability[dateString][role].available > 0) {
        toggleDateSelection(dateString);
    } else {
        alert('This slot is not available for the selected role.');
    }
}

function toggleDateSelection(dateString) {
    const selectedDates = document.getElementById('selected-dates');
    const existingDate = selectedDates.querySelector(`input[value="${dateString}"]`);

    if (existingDate) {
        existingDate.remove();
        calendar.unselect();
    } else {
        const dateInput = document.createElement('input');
        dateInput.type = 'hidden';
        dateInput.name = 'selected_dates[]';
        dateInput.value = dateString;
        selectedDates.appendChild(dateInput);

        calendar.select(dateString);
    }

    updateSignupForm();
}

function updateSignupForm() {
    const selectedDates = document.getElementById('selected-dates').children;
    const signupForm = document.getElementById('signup-form');

    if (selectedDates.length > 0) {
        signupForm.style.display = 'block';
    } else {
        signupForm.style.display = 'none';
    }
}

function updateGoogleSheets(fullName, phone, role, dates) {
    const values = dates.map(date => [date, role, 'false', fullName, phone]);
    gapi.client.sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Sheet1!A:E',
        valueInputOption: 'USER_ENTERED',
        resource: {
            values: values
        }
    }).then((response) => {
        console.log('Data appended successfully');
        loadAllSheetData();
        document.getElementById('volunteer-form').reset();
        document.getElementById('selected-dates').innerHTML = '';
        updateSignupForm();
    });
}

function setupEventListeners() {
    document.getElementById('volunteer-form').addEventListener('submit', handleVolunteerSubmit);
    document.getElementById('role').addEventListener('change', updateCalendar);
    document.getElementById('admin-login-button').addEventListener('click', toggleAdminLoginForm);
    document.getElementById('admin-submit').addEventListener('click', handleAdminLogin);
    document.getElementById('volunteer-lookup-form').addEventListener('submit', handleVolunteerLookup);
}

function handleVolunteerSubmit(e) {
    e.preventDefault();
    const fullName = document.getElementById('full-name').value;
    const phone = document.getElementById('phone').value;
    const role = document.getElementById('role').value;
    const selectedDates = Array.from(document.querySelectorAll('input[name="selected_dates[]"]')).map(input => input.value);

    updateGoogleSheets(fullName, phone, role, selectedDates);
}

function toggleAdminLoginForm() {
    const adminLoginForm = document.getElementById('admin-login-form');
    adminLoginForm.classList.toggle('hidden');
}

function handleAdminLogin() {
    const password = document.getElementById('admin-password').value;
    if (password === ADMIN_PASSWORD) {
        isAdminLoggedIn = true;
        document.getElementById('admin-login-form').classList.add('hidden');
        document.getElementById('admin-panel').classList.remove('hidden');
    } else {
        alert('Incorrect password');
    }
}

async function handleVolunteerLookup(e) {
    e.preventDefault();
    if (!isAdminLoggedIn) return;

    const lookupValue = document.getElementById('lookup-input').value;
    const results = await searchVolunteer(lookupValue);
    displayLookupResults(results);
}

async function searchVolunteer(searchValue) {
    let allResults = [];

    for (const sheetName of Object.keys(availableSlots)) {
        const sheetData = availableSlots[sheetName];
        const results = Object.entries(sheetData.availability).flatMap(([date, roles]) => 
            Object.entries(roles).map(([role, info]) => {
                if (info.name && (info.name.toLowerCase().includes(searchValue.toLowerCase()) || 
                                  info.name.replace(/\D/g, '').includes(searchValue.replace(/\D/g, '')))) {
                    return {
                        name: info.name,
                        date: date,
                        role: role,
                        sheetName: sheetName
                    };
                }
                return null;
            }).filter(result => result !== null)
        );
        allResults = allResults.concat(results);
    }

    return allResults;
}

function displayLookupResults(results) {
    const resultsDiv = document.getElementById('lookup-results');
    resultsDiv.innerHTML = '';

    if (results.length === 0) {
        resultsDiv.innerHTML = '<p>No results found.</p>';
        return;
    }

    const totalDays = results.length;
    const upcomingDays = results.filter(r => new Date(r.date) >= new Date()).length;

    let html = `
        <h3>Results for ${results[0].name}</h3>
        <p>Total days worked/scheduled: ${totalDays}</p>
        <p>Upcoming days scheduled: ${upcomingDays}</p>
        <table>
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Role</th>
                    <th>Sheet</th>
                </tr>
            </thead>
            <tbody>
    `;

    results.forEach(result => {
        html += `
            <tr>
                <td>${result.date}</td>
                <td>${result.role}</td>
                <td>${result.sheetName}</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    resultsDiv.innerHTML = html;
}