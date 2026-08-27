import { createClient } from '@supabase/supabase-js';

/**
 * Клиент Supabase. Ключи приходят из окружения при сборке.
 * В репозитории лежит только .env.example — реальные значения никогда не коммитятся.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase = url && anonKey ? createClient(url, anonKey) : null;

export const hasBackend = (): boolean => supabase !== null;
