module.exports = (req, res) => {
    res.json({
        SPREADSHEET_ID: process.env.SPREADSHEET_ID || 'NOT SET',
        API_KEY: process.env.API_KEY || 'NOT SET',
        CLIENT_ID: process.env.CLIENT_ID || 'NOT SET',
        ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'NOT SET'
    });
};