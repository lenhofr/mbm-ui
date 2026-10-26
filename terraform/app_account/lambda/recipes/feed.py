"""Signed-in reads: GET /me/recipes (the feed) and GET /me/recipes/{id} (docs/recipe-circles.md §7.2).

Unlike the public routes these include private recipes the caller can read, sharedIn
and the caller's access to each recipe.
"""
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

import authz
import repo
from api import load_caller, map_recipe_out, response

SCOPES = ('all', 'mine', 'circle', 'public')


def _owned(recipes, sub):
    return repo.query_all(recipes, IndexName='gsi_owner', ScanIndexForward=False,
                          KeyConditionExpression=Key('ownerSub').eq(sub))


def _public(recipes):
    return repo.query_all(recipes, IndexName='gsi_public', ScanIndexForward=False,
                          KeyConditionExpression=Key('publicPk').eq('PUBLIC'))


def _shared_ids(circles, cid) -> set[str]:
    rows = repo.query_all(circles, ProjectionExpression='sk',
                          KeyConditionExpression=Key('pk').eq(f'CIRCLE#{cid}') & Key('sk').begins_with('RECIPE#'))
    return {r['sk'][len('RECIPE#'):] for r in rows}


def _add_new(result: list, seen: set, items):
    for item in items:
        if item['recipeId'] not in seen:
            seen.add(item['recipeId'])
            result.append(item)


def list_feed(event, params):
    """The caller's recipes plus their brigades' (scope=all, the default), newest first.

    scope=mine: only theirs. scope=circle&circleId=: one brigade's (404 unless a member).
    scope=public: the public catalog (Discover). includePublic=1 adds it to scope=all.
    TODO(pagination): fine while a feed is well under Lambda's 6 MB response limit (§7.2).
    """
    try:
        query = event.get('queryStringParameters') or {}
        scope = query.get('scope') or 'all'
        if scope not in SCOPES:
            return response(400, {'message': f'scope must be one of {", ".join(SCOPES)}'})
        caller = load_caller(event)
        if caller.is_anon:
            return response(401, {'message': 'Sign in to see your recipes'})
        recipes, circles = repo.recipes_table(), repo.circles_table()

        result, seen = [], set()
        if scope == 'circle':
            cid = query.get('circleId') or ''
            if not caller.role_in(cid):
                return response(404, {'message': 'Not found'})
            _add_new(result, seen, repo.batch_get(recipes, 'recipeId', sorted(_shared_ids(circles, cid))))
        elif scope == 'public':
            _add_new(result, seen, _public(recipes))
        else:
            _add_new(result, seen, _owned(recipes, caller.sub))
            if scope == 'all':
                # One query per brigade; sequential is fine for a handful (§7.2 cost).
                ids = set()
                for cid in sorted(caller.memberships):
                    ids |= _shared_ids(circles, cid)
                # A recipe deleted since its edge was written is just missing from the batch.
                _add_new(result, seen, repo.batch_get(recipes, 'recipeId', sorted(ids - seen)))
                if query.get('includePublic') in ('1', 'true'):
                    _add_new(result, seen, _public(recipes))

        # Defense in depth: every source above should only hold readable recipes.
        result = [r for r in result if authz.recipe_access(caller, r).can_read]
        result.sort(key=lambda r: (r.get('updatedAt') or 0, r['recipeId']), reverse=True)
        return response(200, [map_recipe_out(r, caller) for r in result])
    except ClientError as e:
        return response(500, {'error': str(e)})


def get_mine(event, params):
    """Any recipe the caller can read, with their access; 404 for everything else."""
    try:
        caller = load_caller(event)
        item = repo.recipes_table().get_item(Key={'recipeId': params['id']}).get('Item')
        if not item or not authz.recipe_access(caller, item).can_read:
            return response(404, {'message': 'Not found'})
        return response(200, map_recipe_out(item, caller))
    except ClientError as e:
        return response(500, {'error': str(e)})
