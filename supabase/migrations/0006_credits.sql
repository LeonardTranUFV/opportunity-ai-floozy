-- Credit system: 1 credit ~= $0.015 real AI cost. Only AI-driven actions
-- (scan batches, draft generation) cost credits — sending a comment/DM is
-- free since that uses the customer's own connected account, no AI call.
-- Rollover model: unused credits carry into next month rather than resetting,
-- per business decision 2026-08-02.

create table if not exists user_credits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 0,
  plan text not null default 'trial',
  updated_at timestamptz not null default now()
);

alter table user_credits enable row level security;

-- Users can see their own balance, but never write it directly — every
-- change must go through adjust_credits() below so every change is logged
-- to credit_transactions. No insert/update/delete policy is defined on
-- purpose; only the server-side service-role client (or the SECURITY
-- DEFINER function) can write here.
create policy "user_credits_select_own" on user_credits for select using (auth.uid() = user_id);

create table if not exists credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null, -- positive = credit added, negative = credit spent
  reason text not null, -- e.g. 'scan_batch', 'draft_generation', 'monthly_allowance', 'admin_grant', 'top_up_purchase'
  balance_after integer not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

alter table credit_transactions enable row level security;

create policy "credit_transactions_select_own" on credit_transactions for select using (auth.uid() = user_id);

create index if not exists credit_transactions_user_id_idx on credit_transactions (user_id, created_at desc);

-- Atomically adjusts a user's balance and logs the change. Positive amount
-- grants credits (admin grant, monthly rollover top-up, purchased pack);
-- negative amount spends credits (a scan batch, a draft generation) and
-- raises an exception if the balance would go negative, so a caller never
-- has to do a separate check-then-write (which would race under concurrent
-- requests). Runs as SECURITY DEFINER so it can write to user_credits even
-- though the RLS policy above only grants regular users read access.
create or replace function adjust_credits(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_balance integer;
begin
  insert into user_credits (user_id, balance)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  update user_credits
  set balance = balance + p_amount,
      updated_at = now()
  where user_id = p_user_id
  returning balance into v_new_balance;

  if v_new_balance < 0 then
    raise exception 'insufficient_credits' using errcode = 'P0001';
  end if;

  insert into credit_transactions (user_id, amount, reason, balance_after, metadata)
  values (p_user_id, p_amount, p_reason, v_new_balance, p_metadata);

  return v_new_balance;
end;
$$;
