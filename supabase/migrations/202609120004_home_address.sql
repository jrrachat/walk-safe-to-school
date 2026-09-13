-- Preserve the private address text selected during Home setup.
alter table public.saved_locations
  add column if not exists home_address text;

drop function if exists public.set_home(double precision, double precision);

create function public.set_home(
  p_longitude double precision,
  p_latitude double precision,
  p_address text
)
returns uuid language plpgsql security invoker set search_path='' as $$
declare home_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if nullif(trim(p_address), '') is null then raise exception 'Address is required'; end if;

  insert into public.saved_locations(
    owner_id,
    label,
    longitude,
    latitude,
    visibility,
    family_id,
    is_home,
    home_address
  )
  values(
    auth.uid(),
    'Home',
    p_longitude,
    p_latitude,
    'private',
    null,
    true,
    trim(p_address)
  )
  on conflict(owner_id) where is_home
  do update set
    longitude = excluded.longitude,
    latitude = excluded.latitude,
    home_address = excluded.home_address
  returning id into home_id;

  return home_id;
end $$;

revoke execute on function public.set_home(double precision, double precision, text)
  from public, anon;
grant execute on function public.set_home(double precision, double precision, text)
  to authenticated;
