// logger
const logger = {
    log: (message) => console.log(`[INFO] ${message}`),
    error: (message) => console.error(`[ERROR] ${message}`),
    warn: (message) => console.warn(`[WARN] ${message}`)
};

let config;
let availableSlots = {};
let calendar;
let isAdminLoggedIn = false;
let availableDays = [];

document.addEventListener('DOMContentLoaded', () => {
    initializeCalendar();
    setupEventListeners();
    loadConfig();
});

function loadConfig() {
    fetch('/api/secrets')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            config = data;
            console.log('Configuration loaded:', config);
            if (!config.SPREADSHEET_ID) {
                throw new Error('Missing required configuration values');
            }
            loadAllSheetData();
        })
        .catch(err => {
            console.error('Failed to load configuration:', err);
            alert('Failed to initialize application. Please check the console for more information.');
        });
}

function initializeCalendar() {
    const calendarEl = document.getElementById('calendar');
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        selectable: true,
        unselectAuto: false,
        selectConstraint: {
            daysOfWeek: [0, 1, 2, 3, 4, 5, 6]
        },
        headerToolbar: {
            left: 'prev,next',
            center: 'title',
            right: 'today'
        },
        select: function(info) {
            handleDateSelection(info.start);
        },
        eventClick: function(info) {
            handleDateSelection(info.event.start);
        },
        dayCellDidMount: function(info) {
            // This will be updated once we load the sheet data
        }
    });
    calendar.render();
}

async function testAPI() {
    try {
      const response = await fetch('/api/test');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      console.log('API test response:', data);
    } catch (error) {
      console.error('API test failed:', error);
    }
  }
  
  // Call this function before loadAllSheetData
  testAPI();

async function loadAllSheetData() {
    try {
        logger.log('Loading all sheet data...');
        const response = await fetch('/api/sheet-data');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const sheetsData = await response.json();
        
        logger.log('Received sheet data:', JSON.stringify(sheetsData, null, 2));
        
        availableSlots = {};
        availableDays = [];

        for (const sheet of sheetsData) {
            const sheetName = sheet.name;
            logger.log(`Processing sheet: ${sheetName}`);
            const dayIndex = getDayOfWeekFromSheetName(sheetName);
            if (dayIndex !== -1) {
                availableDays.push(dayIndex);
                await updateSheetDates(sheetName, dayIndex);
            }
            availableSlots[sheetName] = processSheetData(sheet.data);
        }

        logger.log('Sheet data loaded and processed successfully');
        logger.log('Final availableSlots:', JSON.stringify(availableSlots, null, 2));
        
        if (!availableSlots || Object.keys(availableSlots).length === 0) {
            throw new Error('No valid data found in availableSlots');
        }

        updateRoleDropdown();
        updateCalendar();
        updateCalendarConstraints();
    } catch (error) {
        logger.error('Error loading or processing sheet data:', error);
        logger.error('Error stack:', error.stack);
        alert('Failed to load or process sheet data. Please check the console for more information and try refreshing the page.');
    }
}

async function updateSheetDates(sheetName, dayIndex) {
    try {
        const response = await fetch(`/api/sheet-data/${sheetName}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();

        const values = data.values || [];
        const currentDate = new Date();
        const dates = values[1] ? values[1].slice(1) : [];
        const lastDate = dates.length > 0 ? new Date(dates[dates.length - 1]) : null;

        if (!lastDate || lastDate < currentDate) {
            const newDates = generateFutureDates(dayIndex, 12); // Generate 12 future dates (3 months)
            const startColumn = dates.length > 0 ? dates.length + 1 : 1; // Start from the next empty column

            await fetch('/api/update-sheet-dates', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sheetName,
                    startColumn,
                    newDates
                }),
            });

            logger.log(`Updated dates for ${sheetName}`);
        }
    } catch (error) {
        logger.error(`Error updating dates for ${sheetName}:`, error);
    }
}

function generateFutureDates(dayIndex, count) {
    const dates = [];
    let currentDate = new Date();
    currentDate.setDate(currentDate.getDate() + (dayIndex - currentDate.getDay() + 7) % 7);

    for (let i = 0; i < count; i++) {
        dates.push(currentDate.toISOString().split('T')[0]);
        currentDate.setDate(currentDate.getDate() + 7);
    }

    return dates;
}

async function getUpdatedSheetData(sheetName) {
    const response = await fetch(`/api/sheet-data/${sheetName}`);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.values || [];
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
    logger.log('Processing sheet data...');
    logger.log('Raw sheet data:', JSON.stringify(data, null, 2));
    
    if (!Array.isArray(data) || data.length < 2) {
        logger.warn('Invalid or empty sheet data structure');
        return { weekNumbers: [], availability: {} };
    }

    const weekNumbers = data[0][0] ? data[0][0].split(',').map(num => parseInt(num.trim())) : [];
    const roles = data.slice(1).map(row => row[0]).filter(role => role);
    const dates = data[1].slice(1);
    
    logger.log('Week numbers:', weekNumbers);
    logger.log('Roles:', roles);
    logger.log('Dates:', dates);
    
    const availability = {};
    dates.forEach((date, dateIndex) => {
        if (date) {
            availability[date] = {};
            const roleGroups = {};
            
            roles.forEach((role, roleIndex) => {
                const genericRole = role.replace(/\s*#\d+$/, '');
                if (!roleGroups[genericRole]) {
                    roleGroups[genericRole] = [];
                }
                roleGroups[genericRole].push(roleIndex);
            });

            Object.entries(roleGroups).forEach(([genericRole, roleIndices]) => {
                const totalSlots = roleIndices.length;
                const filledSlots = roleIndices.filter(roleIndex => 
                    data[roleIndex + 1] && data[roleIndex + 1][dateIndex + 1] && 
                    data[roleIndex + 1][dateIndex + 1] !== 'false'
                ).length;

                availability[date][genericRole] = {
                    total: totalSlots,
                    available: totalSlots - filledSlots
                };
            });
        }
    });

    logger.log('Processed availability:', JSON.stringify(availability, null, 2));
    return {
        weekNumbers,
        availability
    };
}

function updateRoleDropdown() {
    const roleSelect = document.getElementById('role');
    const currentOptions = Array.from(roleSelect.options).map(option => option.value);
    
    const allRoles = new Set();
    
    logger.log('Updating role dropdown with availableSlots:', JSON.stringify(availableSlots, null, 2));

    Object.values(availableSlots).forEach(dayData => {
        if (dayData && dayData.availability) {
            Object.values(dayData.availability).forEach(dateData => {
                Object.keys(dateData).forEach(role => {
                    // Remove any numbering from the role (e.g., "Provider #1" becomes "Provider")
                    const genericRole = role.replace(/\s*#\d+$/, '');
                    allRoles.add(genericRole);
                });
            });
        } else {
            logger.warn('Invalid day data structure:', dayData);
        }
    });

    logger.log('All roles found:', Array.from(allRoles));

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

    logger.log('Role dropdown updated');
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

    logger.log(`Selected date: ${dateString}`);
    logger.log(`Day of week: ${dayOfWeek}`);
    logger.log(`Selected role: ${role}`);
    logger.log('Available slots:', JSON.stringify(availableSlots, null, 2));

    if (!role) {
        alert('Please select a role first.');
        return;
    }

    logger.log(`Checking availability for ${dayOfWeek}`);
    if (availableSlots[dayOfWeek]) {
        logger.log(`Slots found for ${dayOfWeek}`);
        logger.log(`Checking availability for date ${dateString}`);
        if (availableSlots[dayOfWeek].availability[dateString]) {
            logger.log(`Availability found for date ${dateString}`);
            logger.log(`Checking availability for role ${role}`);
            
            // Check for the generic role (without number)
            const genericRole = role.replace(/\s*#\d+$/, '');
            if (availableSlots[dayOfWeek].availability[dateString][genericRole]) {
                logger.log(`Role ${genericRole} found in availability`);
                logger.log(`Available slots: ${availableSlots[dayOfWeek].availability[dateString][genericRole].available}`);
                if (availableSlots[dayOfWeek].availability[dateString][genericRole].available > 0) {
                    logger.log('Slot is available, toggling date selection');
                    toggleDateSelection(dateString, dayOfWeek);
                } else {
                    logger.log('No available slots for this role and date');
                    alert('This slot is not available for the selected role.');
                }
            } else {
                logger.log(`Role ${genericRole} not found in availability`);
                alert('This slot is not available for the selected role.');
            }
        } else {
            logger.log(`No availability found for date ${dateString}`);
            alert('This slot is not available for the selected role.');
        }
    } else {
        logger.log(`No slots found for ${dayOfWeek}`);
        alert('This slot is not available for the selected role.');
    }
}

function toggleDateSelection(dateString, dayOfWeek) {
    const selectedDates = document.getElementById('selected-dates');
    
    if (!selectedDates) {
        console.error('Selected dates container not found');
        return;
    }

    const existingDate = selectedDates.querySelector(`input[value="${dateString}"]`);

    if (existingDate) {
        existingDate.remove();
        calendar.getEvents().forEach(event => {
            if (event.startStr === dateString && event.extendedProps.isSelected) {
                event.remove();
            }
        });
    } else {
        const dateInput = document.createElement('input');
        dateInput.type = 'hidden';
        dateInput.name = 'selected_dates[]';
        dateInput.value = dateString;
        selectedDates.appendChild(dateInput);

        calendar.addEvent({
            start: dateString,
            allDay: true,
            display: 'background',
            color: '#4CAF50',
            extendedProps: {
                isSelected: true
            }
        });
    }

    updateSelectedDatesList();
    updateSignupForm();
}

function updateSelectedDatesList() {
    const selectedDates = document.getElementById('selected-dates');
    const selectedDatesList = document.getElementById('selected-dates-list');
    
    if (!selectedDatesList) {
        logger.warn('Selected dates list element not found');
        return;
    }

    selectedDatesList.innerHTML = '';

    if (!selectedDates) {
        logger.warn('Selected dates input container not found');
        return;
    }

    Array.from(selectedDates.children).forEach(input => {
        const date = new Date(input.value);
        logger.log(`Processing date: ${input.value}, created Date object: ${date}`);
        
        // Use UTC methods to avoid timezone issues
        const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getUTCDay()];
        const formattedDate = `${(date.getUTCMonth() + 1).toString().padStart(2, '0')}/${date.getUTCDate().toString().padStart(2, '0')}/${date.getUTCFullYear()}`;
        
        logger.log(`Calculated day of week: ${dayOfWeek}, formatted date: ${formattedDate}`);
        
        const listItem = document.createElement('li');
        listItem.textContent = `${dayOfWeek} - ${formattedDate}`;
        selectedDatesList.appendChild(listItem);
    });

    selectedDatesList.style.display = selectedDates.children.length > 0 ? 'block' : 'none';
}

function updateSignupForm() {
    const selectedDates = document.getElementById('selected-dates');
    const signupButton = document.getElementById('signup-button');
    const selectedDatesList = document.getElementById('selected-dates-list');

    if (!selectedDates || !signupButton || !selectedDatesList) {
        console.warn('One or more required elements not found');
        return;
    }

    const hasSelectedDates = selectedDates.children.length > 0;

    signupButton.style.display = hasSelectedDates ? 'block' : 'none';
    selectedDatesList.style.display = hasSelectedDates ? 'block' : 'none';

    if (hasSelectedDates) {
        updateSelectedDatesList();
    }
}


async function updateGoogleSheets(fullName, phone, role, dates) {
    logger.log(`Updating Google Sheets for ${fullName}, phone: ${phone}, role: ${role}, dates: ${dates.join(', ')}`);
    
    // Format the name and phone number into a single string
    const formattedNameAndPhone = `${fullName} ${phone}`;
    
    const values = dates.map(date => [date, role, 'false', formattedNameAndPhone]);
    
    try {
        const response = await fetch('/api/update-sheet', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ values }),
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}, message: ${JSON.stringify(result)}`);
        }
        logger.log('Operation completed:', result);

        const successfulDates = result.results.filter(r => r.status === 'success').map(r => r.date);
        const failedDates = result.results.filter(r => r.status !== 'success');

        let message = `Successfully updated schedule for dates: ${successfulDates.join(', ')}`;
        if (failedDates.length > 0) {
            message += `\n\nFailed to update the following dates:\n${failedDates.map(d => `${d.date}: ${d.reason}`).join('\n')}`;
        }

        alert(message);

        loadAllSheetData();
        document.getElementById('volunteer-form').reset();
        document.getElementById('selected-dates').innerHTML = '';
        updateSignupForm();
    } catch (error) {
        logger.error('Error updating Google Sheets:', error);
        alert(`Failed to update the schedule. Please try again later or contact support. Error: ${error.message}`);
    }
}

function setupEventListeners() {
    document.getElementById('volunteer-form').addEventListener('submit', handleVolunteerSubmit);
    document.getElementById('role').addEventListener('change', updateCalendar);
    document.getElementById('admin-login-button').addEventListener('click', toggleAdminLoginForm);
    document.getElementById('admin-submit').addEventListener('click', handleAdminLogin);
    document.getElementById('volunteer-lookup-form').addEventListener('submit', handleVolunteerLookup);
}

function formatPhoneNumber(phoneNumber) {
    // Remove all non-digit characters
    const cleaned = phoneNumber.replace(/\D/g, '');
    
    // Check if the number is valid (10 digits)
    if (cleaned.length !== 10) {
      throw new Error('Invalid phone number. Please enter a 10-digit number.');
    }
    
    // Format as (XXX)-XXX-XXXX
    return `(${cleaned.slice(0, 3)})-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }

  function handleVolunteerSubmit(e) {
    e.preventDefault();
    const fullName = document.getElementById('full-name').value.trim();
    let phone = document.getElementById('phone').value.trim();
    const role = document.getElementById('role').value;
    const selectedDates = Array.from(document.querySelectorAll('input[name="selected_dates[]"]')).map(input => input.value);

    try {
        phone = formatPhoneNumber(phone);
        updateGoogleSheets(fullName, phone, role, selectedDates);
    } catch (error) {
        alert(error.message);
    }
}

function toggleAdminLoginForm() {
    const adminLoginForm = document.getElementById('admin-login-form');
    adminLoginForm.classList.toggle('hidden');
}

function handleAdminLogin() {
    const password = document.getElementById('admin-password').value;
    if (password === config.ADMIN_PASSWORD) {
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