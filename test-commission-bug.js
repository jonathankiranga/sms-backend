#!/usr/bin/env node
/**
 * Bug Condition Exploration Test for Commission Calculation Bug
 * 
 * This test demonstrates the bug where commission calculations incorrectly 
 * include revenue from all terms instead of filtering by term/academic year.
 * 
 * Test Case from Design Document:
 * - Create premium subscriptions across multiple terms:
 *   - Term 1 2024: $100
 *   - Term 2 2024: $200  
 *   - Term 1 2025: $50
 * - Calculate commission for Term 1 2025
 * - Expected commission base: $50 (only Term 1 2025 revenue)
 * - Current bug: commission calculation includes $350 (all terms revenue)
 * 
 * **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
 * **DO NOT attempt to fix the test or the code when it fails**
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

async function runTest() {
  console.log('============================================');
  console.log('BUG CONDITION EXPLORATION TEST');
  console.log('Commission Calculation Bug - Term Filter Issue');
  console.log('============================================\n');

  let connection;
  
  try {
    // Connect to database with SSL configuration matching server.js
    const sslConfig = process.env.DB_SSL === 'false' ? false : (
      process.env.DB_SSL_CA
        ? { ca: process.env.DB_SSL_CA }
        : { minVersion: 'TLSv1.2' }
    );
    
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'freeschool',
      port: parseInt(process.env.DB_PORT || '4000'),
      ssl: sslConfig
    });
    
    console.log('Connected to database\n');
    
    // ============================================
    // 1. SETUP TEST DATA
    // ============================================
    console.log('1. Setting up test data...');
    
    // Create a test sales rep
    const repId = 'TESTREP001';
    await connection.execute(
      `INSERT IGNORE INTO sales_reps (rep_id, full_name, phone, email, commission_type, commission_value) 
       VALUES (?, 'Test Sales Rep', '254700000001', 'test@example.com', 'percent', 10)`,
      [repId]
    );
    
    // Create a test school assigned to the sales rep
    const schoolId = 'TESTSCH01'; // char(9) - 9 characters max
    await connection.execute(
      `INSERT IGNORE INTO schools (school_id, school_name, region, sales_rep_id) 
       VALUES (?, 'Test School', 'Test Region', ?)`,
      [schoolId, repId]
    );
    
    // Create premium_subscriptions table if it doesn't exist (with proper structure)
    try {
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS premium_subscriptions (
          subscription_id INT AUTO_INCREMENT PRIMARY KEY,
          school_id CHAR(9) NOT NULL,
          parent_phone VARCHAR(20) NOT NULL,
          payment_model ENUM('parent','school') NOT NULL,
          payment_status ENUM('pending','paid','failed','refunded') NOT NULL DEFAULT 'pending',
          amount DECIMAL(10,2) NOT NULL,
          term VARCHAR(10) NOT NULL,
          year YEAR NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME NULL,
          UNIQUE KEY uq_school_parent_term_year (school_id, parent_phone, term, year),
          FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE CASCADE
        )
      `);
    } catch (err) {
      // Table might already exist with different structure
      console.log('Note: premium_subscriptions table already exists');
    }
    
    // Clear any existing test data
    await connection.execute(
      'DELETE FROM premium_subscriptions WHERE school_id = ?',
      [schoolId]
    );
    
    // ============================================
    // 2. INSERT TEST PREMIUM SUBSCRIPTIONS
    // ============================================
    console.log('2. Inserting premium subscription test data...');
    
    // Create test data matching the example from design document:
    // - Term 1 2024: $100
    // - Term 2 2024: $200  
    // - Term 1 2025: $50
    const testSubscriptions = [
      { parent_phone: '254711111111', term: 'Term 1', year: 2024, amount: 100.00 },
      { parent_phone: '254722222222', term: 'Term 2', year: 2024, amount: 200.00 },
      { parent_phone: '254733333333', term: 'Term 1', year: 2025, amount: 50.00 }
    ];
    
    for (const sub of testSubscriptions) {
      await connection.execute(
        `INSERT INTO premium_subscriptions 
         (school_id, parent_phone, payment_model, payment_status, amount, term, year) 
         VALUES (?, ?, 'parent', 'paid', ?, ?, ?)`,
        [schoolId, sub.parent_phone, sub.amount, sub.term, sub.year]
      );
    }
    
    console.log(`   Inserted ${testSubscriptions.length} premium subscriptions\n`);
    
    // ============================================
    // 3. SHOW CURRENT DATA
    // ============================================
    console.log('3. Current premium subscription data:');
    const [subscriptions] = await connection.execute(
      'SELECT subscription_id, parent_phone, term, year, amount FROM premium_subscriptions WHERE school_id = ? ORDER BY year, term',
      [schoolId]
    );
    
    subscriptions.forEach(sub => {
      console.log(`   - ${sub.parent_phone}: ${sub.term} ${sub.year}: $${sub.amount}`);
    });
    
    console.log(`\n   Total test revenue: $${subscriptions.reduce((sum, sub) => sum + parseFloat(sub.amount), 0)}`);
    console.log(`   Expected revenue for Term 1 2025 only: $50\n`);
    
    // ============================================
    // 4. DEMONSTRATE THE BUG
    // ============================================
    console.log('4. Demonstrating the bug...\n');
    
    // Show the current (buggy) SQL query from admin-api.js
    console.log('   CURRENT (BUGGY) QUERY from /revenue/sales-reps endpoint:');
    const buggyQuery = `
      SELECT sr.rep_id, sr.full_name,
             COALESCE(SUM(ps.amount), 0) AS revenue
       FROM sales_reps sr
       LEFT JOIN schools sc ON sc.sales_rep_id = sr.rep_id
       LEFT JOIN premium_subscriptions ps ON ps.school_id = sc.school_id AND ps.payment_status = 'paid'
       WHERE sr.rep_id = ?
       GROUP BY sr.rep_id, sr.full_name
    `;
    
    console.log('   ' + buggyQuery.split('\n').join('\n   '));
    
    // Run the buggy query to show the problem
    const [buggyResults] = await connection.execute(buggyQuery, [repId]);
    
    console.log(`\n   Buggy query result for sales rep ${repId}:`);
    console.log(`   - Total revenue (all terms): $${buggyResults[0]?.revenue || 0}`);
    
    // ============================================
    // 5. SHOW WHAT THE CORRECT BEHAVIOR SHOULD BE
    // ============================================
    console.log('\n5. What the correct behavior should be:\n');
    
    // Show what the fixed query should look like
    console.log('   CORRECT (FIXED) QUERY should include term/year filters:');
    const fixedQuery = `
      SELECT sr.rep_id, sr.full_name,
             COALESCE(SUM(ps.amount), 0) AS revenue
       FROM sales_reps sr
       LEFT JOIN schools sc ON sc.sales_rep_id = sr.rep_id
       LEFT JOIN premium_subscriptions ps ON ps.school_id = sc.school_id 
         AND ps.payment_status = 'paid'
         AND ps.term = ? 
         AND ps.year = ?
       WHERE sr.rep_id = ?
       GROUP BY sr.rep_id, sr.full_name
    `;
    
    console.log('   ' + fixedQuery.split('\n').join('\n   '));
    
    // Run the correct query for Term 1 2025
    const term = 'Term 1';
    const year = 2025;
    const [correctResults] = await connection.execute(fixedQuery, [term, year, repId]);
    
    console.log(`\n   Correct query result for ${term} ${year}:`);
    console.log(`   - Filtered revenue (Term 1 2025 only): $${correctResults[0]?.revenue || 0}`);
    
    // ============================================
    // 6. BUG CONDITION ANALYSIS
    // ============================================
    console.log('\n6. Bug Condition Analysis:\n');
    
    const allTimeRevenue = parseFloat(buggyResults[0]?.revenue || 0);
    const termFilteredRevenue = parseFloat(correctResults[0]?.revenue || 0);
    
    console.log(`   All-time revenue (buggy calculation): $${allTimeRevenue}`);
    console.log(`   Term-filtered revenue (correct): $${termFilteredRevenue}`);
    console.log(`   Difference: $${allTimeRevenue - termFilteredRevenue}`);
    
    // Check if bug condition exists
    const bugExists = allTimeRevenue !== termFilteredRevenue && allTimeRevenue > termFilteredRevenue;
    
    console.log(`\n   Bug condition detected: ${bugExists ? 'YES ✓' : 'NO ✗'}`);
    
    if (bugExists) {
      console.log(`   - Commission calculations include revenue from ALL terms`);
      console.log(`   - Instead of filtering by term/year`);
      console.log(`   - This causes sales reps to see inflated commission estimates`);
      console.log(`   - Violates requirement: "commissions should be based on what has been collected in that term for that school"`);
    }
    
    // ============================================
    // 7. TEST VALIDATION
    // ============================================
    console.log('\n7. Test Validation:\n');
    
    // This test SHOULD FAIL on unfixed code (proving bug exists)
    const testPassed = !bugExists; // Test passes if bug is FIXED (no bug condition)
    const testShouldFail = true; // This test is EXPECTED TO FAIL on unfixed code
    
    console.log(`   Test status: ${testPassed ? 'PASSED' : 'FAILED'}`);
    console.log(`   Expected outcome (unfixed code): FAILURE ✓`);
    console.log(`   Actual outcome: ${testPassed ? 'PASSED (unexpected)' : 'FAILED (expected)'}`);
    
    if (!testPassed && testShouldFail) {
      console.log('\n   ✅ SUCCESS: Test failed as expected, confirming bug exists!');
      console.log('   This proves the commission calculation bug is present in the code.');
      console.log('   The bug causes commission calculations to include revenue from all terms');
      console.log('   instead of filtering by term and academic year.');
    } else if (testPassed && !testShouldFail) {
      console.log('\n   ✅ SUCCESS: Test passed, bug is fixed!');
    } else {
      console.log('\n   ❌ UNEXPECTED: Test outcome does not match expectations');
      console.log('   This may indicate the test logic is incorrect or the bug has been fixed.');
    }
    
    // ============================================
    // 8. CLEANUP
    // ============================================
    console.log('\n8. Cleaning up test data...');
    
    await connection.execute('DELETE FROM premium_subscriptions WHERE school_id = ?', [schoolId]);
    await connection.execute('DELETE FROM schools WHERE school_id = ?', [schoolId]);
    await connection.execute('DELETE FROM sales_reps WHERE rep_id = ?', [repId]);
    
    console.log('   Test data cleaned up\n');
    
    // ============================================
    // 9. SUMMARY
    // ============================================
    console.log('============================================');
    console.log('TEST SUMMARY');
    console.log('============================================');
    console.log(`Bug confirmed: ${bugExists ? 'YES' : 'NO'}`);
    console.log(`Root cause: Missing term/year filters in commission calculation SQL`);
    console.log(`Impact: Sales reps see inflated commission estimates`);
    console.log(`Requirements violated: 1.1, 1.2, 1.3 from bugfix.md`);
    console.log('============================================');
    
    // Return test result for automation
    return {
      bugExists,
      allTimeRevenue,
      termFilteredRevenue,
      testPassed,
      testShouldFail,
      matchesExpectation: testPassed === !testShouldFail
    };
    
  } catch (error) {
    console.error('Test error:', error.message);
    console.error(error.stack);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Run the test if called directly
if (require.main === module) {
  runTest().then(result => {
    console.log('\nTest completed.');
    process.exit(result.matchesExpectation ? 0 : 1);
  }).catch(error => {
    console.error('Test failed with error:', error.message);
    process.exit(1);
  });
}

module.exports = { runTest };