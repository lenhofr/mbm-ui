"""recipe_access and friends against the permission matrix in docs/recipe-circles.md §3.1."""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'recipes'))
from authz import (ANONYMOUS, NONE, Caller, can_manage_circle, can_share_into,  # noqa: E402
                   can_unshare_from, recipe_access, visible_circle_ids)

OWNER = 'owner-sub'


def recipe(circles=(), public=False, owner=OWNER):
    r = {'recipeId': 'r1'}
    if owner:
        r['ownerSub'] = owner
    if circles:
        r['circleIds'] = set(circles)
    if public:
        r['publicPk'] = 'PUBLIC'
    return r


def caller(sub='someone', **memberships):
    return Caller(sub, sub, memberships)


def admin(sub='admin', **memberships):
    return Caller(sub, sub, memberships, is_admin=True)


def flags(a):
    return (a.can_read, a.can_edit, a.can_delete, a.can_share, a.relation)


# (who, recipe, expected (read, edit, delete, share, relation))
CASES = [
    # Recipe owner: everything, shared or not, public or not.
    ('owner private', caller(OWNER), recipe(), (True, True, True, True, 'owner')),
    ('owner public, in a circle they left', caller(OWNER), recipe(['c1'], public=True), (True, True, True, True, 'owner')),
    # Circle roles, recipe shared into that circle.
    # A circle owner deletes only what lives entirely in circles they run.
    ('circle owner', caller(c1='owner'), recipe(['c1']), (True, True, True, False, 'circle-editor')),
    ('circle owner of both circles', caller(c1='owner', c2='owner'), recipe(['c1', 'c2']),
     (True, True, True, False, 'circle-editor')),
    ('circle owner, also in a circle they edit', caller(c1='owner', c2='editor'), recipe(['c1', 'c2']),
     (True, True, False, False, 'circle-editor')),
    ('circle owner, also in a circle they are not in', caller(c1='owner'), recipe(['c1', 'c2']),
     (True, True, False, False, 'circle-editor')),
    ('owner of an unrelated circle, public', caller(c2='owner'), recipe(['c1'], public=True),
     (True, False, False, False, 'public')),
    ('circle editor', caller(c1='editor'), recipe(['c1']), (True, True, False, False, 'circle-editor')),
    ('circle member', caller(c1='member'), recipe(['c1']), (True, False, False, False, 'circle-member')),
    ('member of public recipe', caller(c1='member'), recipe(['c1'], public=True), (True, False, False, False, 'circle-member')),
    # Best role across the recipe's circles wins.
    ('member in one, editor in another', caller(c1='member', c2='editor'), recipe(['c1', 'c2']),
     (True, True, False, False, 'circle-editor')),
    # Circle role only counts if the recipe is shared into that circle.
    ('editor of an unrelated circle', caller(c2='editor'), recipe(['c1']), (False, False, False, False, 'none')),
    ('editor of an unrelated circle, public', caller(c2='editor'), recipe(['c1'], public=True),
     (True, False, False, False, 'public')),
    # Strangers and anonymous: public only.
    ('stranger private', caller(), recipe(), (False, False, False, False, 'none')),
    ('stranger public', caller(), recipe(public=True), (True, False, False, False, 'public')),
    ('anonymous private', ANONYMOUS, recipe(['c1']), (False, False, False, False, 'none')),
    ('anonymous public', ANONYMOUS, recipe(public=True), (True, False, False, False, 'public')),
    # Super admins read and delete anything, but don't edit or share.
    ('admin, private', admin(), recipe(), (True, False, True, False, 'admin')),
    ('admin, public', admin(), recipe(public=True), (True, False, True, False, 'public')),
    ('admin, circle editor', admin(c1='editor'), recipe(['c1']), (True, True, True, False, 'circle-editor')),
    ('admin, ownerless', admin(), recipe(owner=None), (True, False, True, False, 'admin')),
    ('admin owns it', admin(OWNER), recipe(), (True, True, True, True, 'owner')),
    # Fail closed.
    ('unknown role', caller(c1='chef'), recipe(['c1']), (False, False, False, False, 'none')),
    ('no circles: no chef delete', caller(c1='owner'), recipe(public=True), (True, False, False, False, 'public')),
    ('no ownerSub: nobody owns it', caller(OWNER), recipe(owner=None), (False, False, False, False, 'none')),
    ('no ownerSub, anonymous', ANONYMOUS, recipe(owner=None), (False, False, False, False, 'none')),
    ('publicPk must be exactly PUBLIC', caller(), {**recipe(), 'publicPk': 'public'}, (False, False, False, False, 'none')),
]


@pytest.mark.parametrize('label, who, r, expected', CASES, ids=[c[0] for c in CASES])
def test_recipe_access(label, who, r, expected):
    assert flags(recipe_access(who, r)) == expected


def test_anonymous_never_matches_an_ownerless_recipe():
    # sub None vs ownerSub None must not count as "same person".
    assert recipe_access(ANONYMOUS, {'recipeId': 'r', 'ownerSub': None}) == NONE
    assert recipe_access(Caller('', None, {}), {'recipeId': 'r', 'ownerSub': ''}) == NONE


def test_access_json():
    assert recipe_access(caller(c1='member'), recipe(['c1'])).to_json() == {
        'canRead': True, 'canEdit': False, 'canDelete': False, 'canShare': False, 'relation': 'circle-member'}


@pytest.mark.parametrize('role, expected', [('owner', True), ('editor', True), ('member', True),
                                            (None, False), ('chef', False)])
def test_share_own_recipe_into_circle(role, expected):
    who = caller(**({'c1': role} if role else {}))
    assert can_share_into(who, 'c1') is expected


@pytest.mark.parametrize('who, expected', [
    (caller(OWNER), True),                      # recipe owner, even outside the circle
    (caller(c1='owner'), True),
    (caller(c1='editor'), True),
    (caller(c1='member'), False),
    (caller(c2='owner'), False),                # owner of a different circle
    (caller(), False),
    (ANONYMOUS, False),
])
def test_unshare_from_this_circle(who, expected):
    assert can_unshare_from(who, 'c1', recipe(['c1'])) is expected


@pytest.mark.parametrize('role, min_role, expected', [
    ('owner', 'owner', True), ('editor', 'owner', False), ('member', 'owner', False),   # roles, rename, delete
    ('owner', 'editor', True), ('editor', 'editor', True), ('member', 'editor', False),  # invite codes
    ('member', 'member', True), (None, 'member', False), ('chef', 'member', False),
])
def test_manage_circle(role, min_role, expected):
    who = caller(**({'c1': role} if role else {}))
    assert can_manage_circle(who, 'c1', min_role) is expected


def test_visible_circle_ids():
    r = recipe(['c1', 'c2', 'c3'])
    assert visible_circle_ids(caller(OWNER), r) == ['c1', 'c2', 'c3']
    assert visible_circle_ids(caller(c3='member', c9='owner'), r) == ['c3']
    assert visible_circle_ids(ANONYMOUS, r) == []
    assert visible_circle_ids(caller(OWNER), recipe()) == []
