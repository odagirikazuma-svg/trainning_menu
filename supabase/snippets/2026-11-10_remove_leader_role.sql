-- ============================================
-- 更新: リーダーの役職を廃止し、練習メニューの作成・編集・削除を
-- 部員なら誰でもできるようにする（マネージャーとOBは除く）
-- ============================================

-- 1) 今リーダー／副リーダーの人を「役職なし」に戻す
update profiles set role = 'member' where role = 'leader';
update member_roster set role = 'member' where role = 'leader';

-- 2) 事前登録の役職からリーダーを外す
alter table member_roster drop constraint if exists member_roster_role_check;
alter table member_roster add constraint member_roster_role_check
  check (role in ('captain', 'vice_captain', 'coach', 'manager', 'member'));

-- 3) メニューの作成・編集・削除の権限
drop policy if exists "menus_insert_captain_only" on menus;
drop policy if exists "menus_insert_team_member" on menus;
create policy "menus_insert_team_member" on menus
  for insert with check (
    team_id in (
      select team_id from profiles
      where id = auth.uid() and role not in ('manager', 'ob')
    )
  );

drop policy if exists "menus_update_leader_coach" on menus;
drop policy if exists "menus_update_team_member" on menus;
create policy "menus_update_team_member" on menus
  for update using (
    team_id in (
      select team_id from profiles
      where id = auth.uid() and role not in ('manager', 'ob')
    )
  );

drop policy if exists "menus_delete_leader_coach" on menus;
drop policy if exists "menus_delete_team_member" on menus;
create policy "menus_delete_team_member" on menus
  for delete using (
    team_id in (
      select team_id from profiles
      where id = auth.uid() and role not in ('manager', 'ob')
    )
  );
