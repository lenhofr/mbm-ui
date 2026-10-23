"""Who can do what to a recipe or circle (docs/recipe-circles.md §3.1, §5).

Pure functions, no I/O: handlers load the recipe and the caller's memberships, then ask
here. Not wired into the routes yet (Phase 1). Fail closed: a recipe without ownerSub
has no owner, and an unknown role grants nothing. Memberships in a circle that's being
deleted must be left out when the Caller is built.
"""
from dataclasses import dataclass

ROLE_RANK = {'member': 1, 'editor': 2, 'owner': 3}


def _rank(role: str | None) -> int:
    return ROLE_RANK.get(role or '', 0)


@dataclass(frozen=True)
class Caller:
    sub: str | None              # None = anonymous
    name: str | None
    memberships: dict            # cid -> role ("member" | "editor" | "owner")
    is_admin: bool = False       # in the "admins" Cognito group: may read and delete any recipe

    @property
    def is_anon(self) -> bool:
        return self.sub is None

    def role_in(self, cid: str) -> str | None:
        return self.memberships.get(cid)


ANONYMOUS = Caller(None, None, {})


@dataclass(frozen=True)
class Access:
    can_read: bool
    can_edit: bool
    can_delete: bool
    can_share: bool              # change the public flag or the circle set
    relation: str                # "owner" | "circle-editor" | "circle-member" | "public" | "admin" | "none"

    def to_json(self) -> dict:
        return {'canRead': self.can_read, 'canEdit': self.can_edit,
                'canDelete': self.can_delete, 'canShare': self.can_share,
                'relation': self.relation}


NONE = Access(False, False, False, False, 'none')


def _is_owner(caller: Caller, recipe: dict) -> bool:
    owner = recipe.get('ownerSub')
    return bool(caller.sub) and bool(owner) and caller.sub == owner


def recipe_access(caller: Caller, recipe: dict) -> Access:
    if _is_owner(caller, recipe):
        return Access(True, True, True, True, 'owner')

    circle_ids = set(recipe.get('circleIds') or ())
    best = max((_rank(caller.memberships[c]) for c in circle_ids if c in caller.memberships), default=0)
    # A circle owner can delete a recipe that lives only in circles they run; one that's
    # also in another brigade they can only unshare (docs/recipe-circles.md §14.7).
    chef_of_all = bool(circle_ids) and all(caller.role_in(c) == 'owner' for c in circle_ids)
    can_delete = chef_of_all or caller.is_admin
    if best >= ROLE_RANK['editor']:
        return Access(True, True, can_delete, False, 'circle-editor')
    if best >= ROLE_RANK['member']:
        return Access(True, False, can_delete, False, 'circle-member')
    if recipe.get('publicPk') == 'PUBLIC':
        return Access(True, False, can_delete, False, 'public')
    if caller.is_admin:
        return Access(True, False, True, False, 'admin')
    return NONE


def can_share_into(caller: Caller, cid: str) -> bool:
    """A recipe's owner may add it to cid only while they're a member of cid (I2)."""
    return _rank(caller.role_in(cid)) > 0


def can_unshare_from(caller: Caller, cid: str, recipe: dict) -> bool:
    """The owner, or an editor of the circle, can take a recipe out of it."""
    return _is_owner(caller, recipe) or _rank(caller.role_in(cid)) >= ROLE_RANK['editor']


def can_manage_circle(caller: Caller, cid: str, min_role: str) -> bool:
    return _rank(caller.role_in(cid)) >= ROLE_RANK[min_role]


def visible_circle_ids(caller: Caller, recipe: dict) -> list[str]:
    """The recipe's circles the caller may see: all of them for the owner, else shared ones (I6)."""
    ids = set(recipe.get('circleIds') or ())
    if _is_owner(caller, recipe):
        return sorted(ids)
    return sorted(ids & caller.memberships.keys())
