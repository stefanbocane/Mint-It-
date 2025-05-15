// Script to update all screens to use ScreenBackground

const fs = require('fs');
const path = require('path');
const util = require('util');

const readdir = util.promisify(fs.readdir);
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
const stat = util.promisify(fs.stat);

const SCREENS_DIR = path.join(__dirname, 'src', 'screens');
const IMPORT_LINE = "import ScreenBackground from '../components/ScreenBackground';";
const VIEW_BG_PATTERN = /<View style={[\w\s\[\],.{}:'"()-]+backgroundColor:[\w\s]*theme\.colors\.background/g;
const BG_IMAGE_PATTERN = /<BackgroundImage[^>]*>([\s\S]*?)<\/BackgroundImage>/g;

async function updateScreenFiles() {
  try {
    // Get all screen files
    const files = await readdir(SCREENS_DIR);
    const screenFiles = files.filter(file => 
      file.endsWith('.js') || file.endsWith('.tsx') || file.endsWith('.jsx')
    );
    
    console.log(`Found ${screenFiles.length} screen files to process`);
    
    for (const file of screenFiles) {
      const filePath = path.join(SCREENS_DIR, file);
      const fileStats = await stat(filePath);
      
      if (!fileStats.isFile()) continue;
      
      console.log(`Processing ${file}...`);
      
      // Read the file content
      let content = await readFile(filePath, 'utf8');
      let modified = false;
      
      // Check if the file already has the ScreenBackground import
      if (!content.includes('ScreenBackground')) {
        // Add the import line after the last import
        const lastImportIndex = content.lastIndexOf('import ');
        if (lastImportIndex !== -1) {
          const importEndIndex = content.indexOf(';', lastImportIndex) + 1;
          content = content.slice(0, importEndIndex) + '\n' + IMPORT_LINE + content.slice(importEndIndex);
          modified = true;
        }
      }
      
      // Replace BackgroundImage pattern with ScreenBackground
      if (BG_IMAGE_PATTERN.test(content)) {
        content = content.replace(BG_IMAGE_PATTERN, (match, innerContent) => {
          // Handle cases where View with backgroundColor is inside BackgroundImage
          innerContent = innerContent.replace(VIEW_BG_PATTERN, (viewMatch) => {
            return viewMatch.replace(/backgroundColor:[\w\s]*theme\.colors\.background/, '');
          });
          
          return `<ScreenBackground>${innerContent}</ScreenBackground>`;
        });
        modified = true;
      } else {
        // Replace View with backgroundColor: theme.colors.background to ScreenBackground
        if (VIEW_BG_PATTERN.test(content)) {
          content = content.replace(VIEW_BG_PATTERN, (match) => {
            // Replace the backgroundColor prop while keeping the rest of the style props
            return match.replace(/backgroundColor:[\w\s]*theme\.colors\.background/, '');
          });
          
          // Find the root return View and wrap with ScreenBackground
          const returnPattern = /return\s*\(\s*<View/g;
          if (returnPattern.test(content)) {
            content = content.replace(returnPattern, 'return (\n    <ScreenBackground>\n      <View');
            
            // Find the matching closing View for the return statement
            // This is a simplistic approach and might not work for all files
            const returnClosePattern = /return\s*\(\s*<View[\s\S]*?<\/View>\s*\);/g;
            content = content.replace(returnClosePattern, (match) => {
              return match.replace(/<\/View>\s*\);/, '</View>\n    </ScreenBackground>\n  );');
            });
            modified = true;
          }
        }
      }
      
      // Save the file if changes were made
      if (modified) {
        await writeFile(filePath, content, 'utf8');
        console.log(`✅ Updated ${file}`);
      } else {
        console.log(`⏭️ No changes needed for ${file}`);
      }
    }
    
    console.log('All screen files processed successfully!');
  } catch (error) {
    console.error('Error updating screen files:', error);
  }
}

updateScreenFiles(); 