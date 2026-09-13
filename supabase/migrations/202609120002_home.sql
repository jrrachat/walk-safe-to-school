-- One private Home per account, stored using the existing saved-place RLS.
alter table public.saved_locations add column is_home boolean not null default false;
alter table public.saved_locations add constraint home_is_private
  check (not is_home or (visibility = 'private' and family_id is null and label = 'Home'));
create unique index one_home_per_owner on public.saved_locations(owner_id) where is_home;

create function public.set_home(p_longitude double precision,p_latitude double precision)
returns uuid language plpgsql security invoker set search_path='' as $$
declare home_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into public.saved_locations(owner_id,label,longitude,latitude,visibility,family_id,is_home)
  values(auth.uid(),'Home',p_longitude,p_latitude,'private',null,true)
  on conflict(owner_id) where is_home
  do update set longitude=excluded.longitude,latitude=excluded.latitude
  returning id into home_id;
  return home_id;
end $$;
revoke execute on function public.set_home(double precision,double precision) from public,anon;
grant execute on function public.set_home(double precision,double precision) to authenticated;
