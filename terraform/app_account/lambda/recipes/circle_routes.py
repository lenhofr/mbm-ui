"""Brigade routes (circles in code): list, create, rename, roles, leave/remove, delete, and
taking a recipe out of a brigade (docs/recipe-circles.md §6.5, §7.1).

Every multi-item write is one transaction whose conditions restate why it was allowed
(the caller is still a Chef, the member still has the role we read), and META updates
always require META to exist, because an UpdateItem would otherwise create it.
"""
import time
import uuid
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

import authz
import repo
from api import get_identity, load_caller, response
from recipe_input import BadRequest, parse_circle_body, parse_role

MAX_CIRCLES_PER_USER = 50   # §11.6
LAST_CHEF = 'Every brigade needs a Chef. Make someone else Chef first.'


def _pk(cid):
    return f'CIRCLE#{cid}'


def _meta_key(cid):
    return {'pk': _pk(cid), 'sk': 'META'}


def _member_key(cid, sub):
    return {'pk': _pk(cid), 'sk': f'MEMBER#{sub}'}


def _not_found():
    return response(404, {'message': 'Not found'})


def _cancelled(e) -> bool:
    return e.response.get('Error', {}).get('Code') == 'TransactionCanceledException'


def _still_chef(circles, cid, sub):
    """ConditionCheck that sub is still an owner of cid."""
    return {'ConditionCheck': {'TableName': circles, 'Key': _member_key(cid, sub),
                               'ConditionExpression': '#r = :owner',
                               'ExpressionAttributeNames': {'#r': 'role'},
                               'ExpressionAttributeValues': {':owner': 'owner'}}}


def _summary(meta, role):
    out = {'id': meta['pk'][len('CIRCLE#'):], 'name': meta.get('name'), 'role': role,
           'memberCount': meta.get('memberCount', 0)}
    if meta.get('emoji'):
        out['emoji'] = meta['emoji']
    return out


def _member_out(row):
    # Never emails (§11.4): members carry only a display name.
    return {'sub': row['sk'][len('MEMBER#'):], 'displayName': row.get('displayName'),
            'role': row.get('role'), 'joinedAt': row.get('joinedAt')}


def _detail(circles, cid, role):
    """The brigade with its members (Chefs first), or None if it's gone or being deleted."""
    rows = repo.query_all(circles, KeyConditionExpression=Key('pk').eq(_pk(cid)))
    meta = next((r for r in rows if r['sk'] == 'META'), None)
    if not meta or meta.get('deleting'):
        return None
    members = [_member_out(r) for r in rows if r['sk'].startswith('MEMBER#')]
    members.sort(key=lambda m: (-authz.ROLE_RANK.get(m['role'] or '', 0), (m['displayName'] or '').lower()))
    return {**_summary(meta, role), 'ownerCount': meta.get('ownerCount', 0),
            'recipeCount': sum(r['sk'].startswith('RECIPE#') for r in rows), 'members': members}


def list_mine(event, params):
    """GET /me/circles: the caller's brigades with their role, by name."""
    try:
        caller = load_caller(event)
        if not caller.memberships:
            return response(200, [])
        metas = repo.batch_get_keys(repo.circles_table(), [_meta_key(cid) for cid in caller.memberships])
        out = [_summary(m, caller.role_in(m['pk'][len('CIRCLE#'):])) for m in metas]
        out.sort(key=lambda c: ((c['name'] or '').lower(), c['id']))
        return response(200, out)
    except ClientError as e:
        return response(500, {'error': str(e)})


def create(event, params):
    """POST /circles {name, emoji?}: a new brigade with the caller as its Chef."""
    try:
        fields = parse_circle_body(event.get('body'))
        caller = load_caller(event)
        if caller.is_anon:
            return response(401, {'message': 'Sign in to start a brigade'})
        if len(caller.memberships) >= MAX_CIRCLES_PER_USER:
            return response(400, {'message': f"You're already in {MAX_CIRCLES_PER_USER} brigades"})
        cid, now = uuid.uuid4().hex, int(time.time())
        name = get_identity(event).get('name')
        circles = repo.circles_table()
        meta = {**_meta_key(cid), **{k: v for k, v in fields.items() if v is not None},
                'createdBySub': caller.sub, 'createdAt': now, 'memberCount': 1, 'ownerCount': 1, 'version': 1}
        member = {**_member_key(cid, caller.sub), 'gsi1pk': f'USER#{caller.sub}', 'gsi1sk': _pk(cid),
                  'role': 'owner', 'displayName': name, 'circleName': fields['name'], 'joinedAt': now}
        repo.transact([
            {'Put': {'TableName': circles, 'Item': meta, 'ConditionExpression': 'attribute_not_exists(pk)'}},
            {'Put': {'TableName': circles, 'Item': member}},
        ])
        return response(201, _detail(circles, cid, 'owner'))
    except BadRequest as e:
        return response(400, {'message': str(e)})
    except ClientError as e:
        return response(500, {'error': str(e)})


def get(event, params):
    """GET /circles/{cid}: members only; everyone else gets 404."""
    try:
        caller = load_caller(event)
        role = caller.role_in(params['cid'])
        detail = _detail(repo.circles_table(), params['cid'], role) if role else None
        return response(200, detail) if detail else _not_found()
    except ClientError as e:
        return response(500, {'error': str(e)})


def update(event, params):
    """PATCH /circles/{cid} {name?, emoji?}: Chef only. The new name is copied onto every
    membership afterwards; if that's interrupted the names are only cosmetically stale and
    reconcile-circles.mjs --fix catches up."""
    cid = params['cid']
    try:
        fields = parse_circle_body(event.get('body'), partial=True)
        caller = load_caller(event)
        role = caller.role_in(cid)
        if not role:
            return _not_found()
        if role != 'owner':
            return response(403, {'message': 'Only the Chef can rename the brigade'})
        circles = repo.circles_table()
        sets, removes, names, values = [], [], {'#ver': 'version'}, {':one': 1}
        for k, v in fields.items():
            names[f'#{k}'] = k
            if v is None:
                removes.append(f'#{k}')
            else:
                sets.append(f'#{k} = :{k}')
                values[f':{k}'] = v
        expr = (f'SET {", ".join(sets)} ' if sets else '') + (f'REMOVE {", ".join(removes)} ' if removes else '')
        meta_update = {'TableName': circles, 'Key': _meta_key(cid), 'UpdateExpression': expr + 'ADD #ver :one',
                       'ConditionExpression': 'attribute_exists(pk) AND attribute_not_exists(deleting)',
                       'ExpressionAttributeNames': names, 'ExpressionAttributeValues': values}
        try:
            repo.transact([{'Update': meta_update}, _still_chef(circles, cid, caller.sub)])
        except ClientError as e:
            if _cancelled(e):
                return _not_found()
            raise
        if 'name' in fields:
            rows = repo.query_all(circles, ProjectionExpression='pk, sk',
                                  KeyConditionExpression=Key('pk').eq(_pk(cid)) & Key('sk').begins_with('MEMBER#'))
            for row in rows:
                try:
                    circles.update_item(Key={'pk': row['pk'], 'sk': row['sk']},
                                        UpdateExpression='SET circleName = :n', ConditionExpression='attribute_exists(sk)',
                                        ExpressionAttributeValues={':n': fields['name']})
                except ClientError as e:
                    if e.response.get('Error', {}).get('Code') != 'ConditionalCheckFailedException':
                        raise
        detail = _detail(circles, cid, role)
        return response(200, detail) if detail else _not_found()
    except BadRequest as e:
        return response(400, {'message': str(e)})
    except ClientError as e:
        return response(500, {'error': str(e)})


def _meta_count_update(circles, cid, members: int, owners: int, keep_a_chef: bool):
    """Update META's counts; keep_a_chef adds the I3 condition (another owner remains)."""
    names, values, adds = {}, {}, []
    for attr, delta in (('memberCount', members), ('ownerCount', owners)):
        if delta:
            names[f'#{attr}'] = attr
            values[f':{attr}'] = delta
            adds.append(f'#{attr} :{attr}')
    cond = 'attribute_exists(pk) AND attribute_not_exists(deleting)'
    if keep_a_chef:
        names['#ownerCount'] = 'ownerCount'
        values[':one'] = 1
        cond += ' AND #ownerCount > :one'
    if not adds:
        return {'ConditionCheck': {'TableName': circles, 'Key': _meta_key(cid), 'ConditionExpression': cond,
                                   **({'ExpressionAttributeNames': names, 'ExpressionAttributeValues': values}
                                      if names else {})}}
    return {'Update': {'TableName': circles, 'Key': _meta_key(cid), 'UpdateExpression': 'ADD ' + ', '.join(adds),
                       'ConditionExpression': cond, 'ExpressionAttributeNames': names,
                       'ExpressionAttributeValues': values}}


def set_role(event, params):
    """PUT /circles/{cid}/members/{sub} {role}: Chef only; the last Chef can't step down (I3)."""
    cid, target_sub = params['cid'], params['sub']
    try:
        new_role = parse_role(event.get('body'))
        caller = load_caller(event)
        role = caller.role_in(cid)
        if not role:
            return _not_found()
        if role != 'owner':
            return response(403, {'message': 'Only the Chef can change roles'})
        circles = repo.circles_table()
        target = circles.get_item(Key=_member_key(cid, target_sub)).get('Item')
        if not target:
            return _not_found()
        old_role = target.get('role')
        if old_role == new_role:
            return response(200, _member_out(target))

        owners = (new_role == 'owner') - (old_role == 'owner')
        actions = [{'Update': {'TableName': circles, 'Key': _member_key(cid, target_sub),
                               'UpdateExpression': 'SET #r = :new',
                               'ConditionExpression': 'attribute_exists(sk) AND #r = :old',
                               'ExpressionAttributeNames': {'#r': 'role'},
                               'ExpressionAttributeValues': {':new': new_role, ':old': old_role}}},
                   _meta_count_update(circles, cid, 0, owners, keep_a_chef=owners < 0)]
        if target_sub != caller.sub:
            actions.append(_still_chef(circles, cid, caller.sub))
        try:
            repo.transact(actions)
        except ClientError as e:
            if not _cancelled(e):
                raise
            if owners < 0 and repo.cancellation_codes(e)[1] == 'ConditionalCheckFailed':
                return response(400, {'message': LAST_CHEF})
            return response(409, {'message': 'The brigade just changed; take another look'})
        return response(200, _member_out({**target, 'role': new_role}))
    except BadRequest as e:
        return response(400, {'message': str(e)})
    except ClientError as e:
        return response(500, {'error': str(e)})


def remove_member(event, params):
    """DELETE /circles/{cid}/members/{sub}: leave (yourself) or remove someone (Chef).

    No cascade (§14.6): the departing cook's recipes stay shared into the brigade.
    """
    cid, target_sub = params['cid'], params['sub']
    try:
        caller = load_caller(event)
        role = caller.role_in(cid)
        leaving = target_sub == caller.sub
        if not role:
            return _not_found()
        if not leaving and role != 'owner':
            return response(403, {'message': 'Only the Chef can remove people'})
        circles = repo.circles_table()
        target = circles.get_item(Key=_member_key(cid, target_sub)).get('Item')
        if not target:
            return response(204, {})
        was_chef = target.get('role') == 'owner'
        actions = [{'Delete': {'TableName': circles, 'Key': _member_key(cid, target_sub),
                               'ConditionExpression': 'attribute_exists(sk) AND #r = :old',
                               'ExpressionAttributeNames': {'#r': 'role'},
                               'ExpressionAttributeValues': {':old': target.get('role')}}},
                   _meta_count_update(circles, cid, -1, -1 if was_chef else 0, keep_a_chef=was_chef)]
        if not leaving:
            actions.append(_still_chef(circles, cid, caller.sub))
        try:
            repo.transact(actions)
        except ClientError as e:
            if not _cancelled(e):
                raise
            if was_chef and repo.cancellation_codes(e)[1] == 'ConditionalCheckFailed':
                return response(400, {'message': LAST_CHEF})
            return response(409, {'message': 'The brigade just changed; take another look'})
        return response(204, {})
    except ClientError as e:
        return response(500, {'error': str(e)})


def _drop_share(recipes, circles, cid, rid):
    """Take rid out of cid: the recipe's circleIds and the edge together (I1)."""
    edge = {'Delete': {'TableName': circles, 'Key': {'pk': _pk(cid), 'sk': f'RECIPE#{rid}'}}}
    try:
        repo.transact([{'Update': {'TableName': recipes, 'Key': {'recipeId': rid},
                                   'UpdateExpression': 'DELETE #c :cid ADD #ver :one',
                                   'ConditionExpression': 'attribute_exists(recipeId)',
                                   'ExpressionAttributeNames': {'#c': 'circleIds', '#ver': 'version'},
                                   'ExpressionAttributeValues': {':cid': {cid}, ':one': 1}}}, edge])
    except ClientError as e:
        if not _cancelled(e):
            raise
        # The recipe is gone: only the dangling edge is left to remove.
        circles.delete_item(Key=edge['Delete']['Key'])


def delete(event, params):
    """DELETE /circles/{cid}: Chef only. Resumable (§6.5): mark META deleting (authz ignores
    the brigade from then on), unshare its recipes, drop the members, and delete META last.

    The Chef's own membership goes just before META, and it's read directly here rather
    than through load_caller (which skips deleting brigades), so an interrupted delete can
    simply be retried.
    """
    cid = params['cid']
    try:
        caller = load_caller(event)
        circles, recipes = repo.circles_table(), repo.recipes_table()
        me = circles.get_item(Key=_member_key(cid, caller.sub)).get('Item') if caller.sub else None
        if not me:
            return _not_found()
        if me.get('role') != 'owner':
            return response(403, {'message': 'Only the Chef can delete the brigade'})
        try:
            circles.update_item(Key=_meta_key(cid), UpdateExpression='SET deleting = :t',
                                ConditionExpression='attribute_exists(pk)', ExpressionAttributeValues={':t': True})
        except ClientError as e:
            if e.response.get('Error', {}).get('Code') != 'ConditionalCheckFailedException':
                raise
        rows = repo.query_all(circles, ProjectionExpression='pk, sk', KeyConditionExpression=Key('pk').eq(_pk(cid)))
        mine = f'MEMBER#{caller.sub}'
        for row in sorted(rows, key=lambda r: (r['sk'] == 'META', r['sk'] == mine)):
            if row['sk'].startswith('RECIPE#'):
                _drop_share(recipes, circles, cid, row['sk'][len('RECIPE#'):])
            else:
                circles.delete_item(Key={'pk': row['pk'], 'sk': row['sk']})
        return response(204, {})
    except ClientError as e:
        return response(500, {'error': str(e)})


def unshare_recipe(event, params):
    """DELETE /circles/{cid}/recipes/{rid}: the recipe's owner, or a Sous-chef or Chef of the
    brigade, takes it out of the brigade. The recipe itself stays."""
    cid, rid = params['cid'], params['rid']
    try:
        caller = load_caller(event)
        recipes, circles = repo.recipes_table(), repo.circles_table()
        recipe = recipes.get_item(Key={'recipeId': rid}).get('Item')
        if not recipe or not authz.recipe_access(caller, recipe).can_read:
            return _not_found()
        if cid not in (recipe.get('circleIds') or ()):
            return response(204, {})
        if not authz.can_unshare_from(caller, cid, recipe):
            return response(403, {'message': "Only the recipe's cook or the brigade's Sous-chefs can do that"})
        is_owner = recipe.get('ownerSub') == caller.sub
        cond, names = 'contains(#c, :cid)', {'#c': 'circleIds', '#ver': 'version'}
        values = {':cid': cid, ':cids': {cid}, ':one': 1}
        if is_owner:
            cond += ' AND ownerSub = :sub'
            values[':sub'] = caller.sub
        actions = [{'Update': {'TableName': recipes, 'Key': {'recipeId': rid},
                               'UpdateExpression': 'DELETE #c :cids ADD #ver :one', 'ConditionExpression': cond,
                               'ExpressionAttributeNames': names, 'ExpressionAttributeValues': values}},
                   {'Delete': {'TableName': circles, 'Key': {'pk': _pk(cid), 'sk': f'RECIPE#{rid}'}}}]
        if not is_owner:
            actions.append({'ConditionCheck': {
                'TableName': circles, 'Key': _member_key(cid, caller.sub),
                'ConditionExpression': '#r IN (:editor, :owner)', 'ExpressionAttributeNames': {'#r': 'role'},
                'ExpressionAttributeValues': {':editor': 'editor', ':owner': 'owner'}}})
        try:
            repo.transact(actions)
        except ClientError as e:
            if _cancelled(e):
                return response(409, {'message': 'This recipe just changed; take another look'})
            raise
        return response(204, {})
    except ClientError as e:
        return response(500, {'error': str(e)})
