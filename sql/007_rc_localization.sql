-- Migration 007: RC Localization
-- Добавляет колонки JSONB для мультиязычных переводов ЖК.

ALTER TABLE client_residential_complexes 
ADD COLUMN IF NOT EXISTS name_translations JSONB DEFAULT NULL,
ADD COLUMN IF NOT EXISTS name_normalized_translations JSONB DEFAULT NULL;
