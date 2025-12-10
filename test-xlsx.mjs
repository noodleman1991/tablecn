import pkg from 'xlsx';
const XLSX = pkg;
import fs from 'fs';

const filePath = '/Users/amitlockshinski/WebstormProjects/tablecn/orders-2025-12-05-21-21-50.xlsx';

console.log('File exists:', fs.existsSync(filePath));
console.log('XLSX methods:', Object.keys(XLSX).slice(0, 20));

try {
  console.log('Attempting to read workbook...');
  const workbook = XLSX.readFile(filePath);
  console.log('Success! Sheets:', workbook.SheetNames);
  console.log('First sheet data rows:', XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]).length);
} catch (error) {
  console.error('Error:', error);
  console.error('Error stack:', error.stack);
}
