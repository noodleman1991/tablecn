-- Migration: Add WooCommerce Order Date Field
-- Created: 2026-01-07
-- Purpose: Store actual order purchase date (not DB sync date)

-- Add WooCommerce order date field to attendees table
ALTER TABLE tablecn_attendees
ADD COLUMN IF NOT EXISTS woocommerce_order_date TIMESTAMP;

-- Add index for date-based queries and analytics
CREATE INDEX IF NOT EXISTS idx_attendees_order_date
ON tablecn_attendees(woocommerce_order_date);

-- Add helpful comment explaining the field
COMMENT ON COLUMN tablecn_attendees.woocommerce_order_date
IS 'Date when the WooCommerce order was placed (from order.date_created). This is NOT the same as created_at which stores when the record was synced to the database.';
