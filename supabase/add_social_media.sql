-- ============================================================
-- Migration: Add social media columns to shops
-- Run this in the Supabase SQL Editor (once, on existing DBs)
-- ============================================================

alter table public.shops
  add column if not exists instagram text,
  add column if not exists tiktok    text,
  add column if not exists facebook  text,
  add column if not exists youtube   text,
  add column if not exists website   text;
