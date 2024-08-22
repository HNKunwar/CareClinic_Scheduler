// Google Sheets API configuration
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID';
const API_KEY = 'YOUR_API_KEY';
const CLIENT_ID = 'YOUR_CLIENT_ID';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

let availableSlots = {};
let calendar;

document.addEventListener('DOMContentLoaded', () => {
    gapi.load('client:auth2', initClient);
    initializeCalendar();
});

function initClient() {
    gapi.client.init({
        apiKey: API_KEY,
        clientId: CLIENT_ID,
        scope: SCOPE
    }).then(() => {
        // Load the slots from Google Sheets
        loadAvailableSlots();
    });
}

function loadAvailableSlots() {
    gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Sheet1!A:D'  // Adjust the range as needed
    }).then((response) => {
        const values = response.result.values;
        if (values.length > 0) {
            values.forEach((row) => {
                const [date, role, available, name] = row;
                if (!availableSlots[date]) availableSlots[date] = {};
                availableSlots[date][role] = { available: available === 'true', name };
            });
        }
        updateCalendar();
    });
}

function initializeCalendar() {
    const calendarEl = document.getElementById('calendar');
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        selectable: true,
        selectConstraint: {
            daysOfWeek: [2, 3, 4] // Only allow selection on Tuesday, Wednesday, Thursday
        },
        select: function(info) {
            handleDateSelection(info.start);
        },
        dayCellDidMount: function(info) {
            // Disable weekends and days other than Tue, Wed, Thu
            if (![2, 3, 4].includes(info.date.getDay())) {
                info.el.classList.add('fc-day-disabled');
            }
        }
    });
    calendar.render();
}

function updateCalendar() {
    const role = document.getElementById('role').value;
    calendar.removeAllEventSources();

    if (role) {
        const events = Object.entries(availableSlots).map(([date, roles]) => {
            const roleInfo = roles[role];
            if (roleInfo) {
                return {
                    start: date,
                    display: 'background',
                    color: roleInfo.available ? '#e0f7fa' : '#ffcdd2'
                };
            }
            return null;
        }).filter(event => event !== null);

        calendar.addEventSource(events);
    }

    calendar.refetchEvents();
}

function handleDateSelection(date) {
    const dateString = date.toISOString().split('T')[0];
    const role = document.getElementById('role').value;

    if (role && availableSlots[dateString] && availableSlots[dateString][role] && availableSlots[dateString][role].available) {
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

document.getElementById('volunteer-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fullName = document.getElementById('full-name').value;
    const phone = document.getElementById('phone').value;
    const role = document.getElementById('role').value;
    const selectedDates = Array.from(document.querySelectorAll('input[name="selected_dates[]"]')).map(input => input.value);

    // Update Google Sheets
    updateGoogleSheets(fullName, phone, role, selectedDates);
});

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
        // Reload available slots and update the calendar
        loadAvailableSlots();
        // Clear the form and selected dates
        document.getElementById('volunteer-form').reset();
        document.getElementById('selected-dates').innerHTML = '';
        updateSignupForm();
    });
}

document.getElementById('role').addEventListener('change', updateCalendar);