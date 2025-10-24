const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

async function runMigration() {
  try {
    // Read .env or use environment variables
    const envPath = '.env';
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const supabaseUrl = envContent.match(/SUPABASE_URL=(.*)/)?.[1];
      const supabaseServiceKey = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)?.[1];

      if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error('Missing Supabase credentials in .env');
      }

      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // Read the migration file
      const sql = fs.readFileSync('supabase/18-add-border-type-column.sql', 'utf8');

      console.log('🚀 Running migration to add border_type column...\n');

      // Split the SQL into statements
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (const statement of statements) {
        if (statement.includes('ALTER TABLE')) {
          const { error } = await supabase.rpc('exec_sql', { query: statement });
          if (error && !error.message.includes('already exists')) {
            console.error('Error:', error.message);
          }
        }
      }

      console.log('✅ Migration completed!');
      console.log('\nPlease verify by running this SQL in Supabase SQL Editor:');
      console.log('SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = \'cards\' AND column_name = \'border_type\';');
    } else {
      console.error('❌ .env file not found');
      showManualInstructions();
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    showManualInstructions();
  }
}

function showManualInstructions() {
  console.log('\n' + '='.repeat(60));
  console.log('📋 Please run this SQL manually in Supabase SQL Editor:');
  console.log('='.repeat(60) + '\n');
  const sql = fs.readFileSync('supabase/18-add-border-type-column.sql', 'utf8');
  console.log(sql);
  console.log('\n' + '='.repeat(60));
}

runMigration();
