from app.models import User


def run(app, *args, input=None):
    return app.test_cli_runner().invoke(args=list(args), input=input)


def test_create_list_and_reset(app):
    # two businesses exist in the test fixture, so a business id is required
    r = run(app, "create-user", "--username", "milker2", "--full-name", "Second Milker", "--role", "milker",
            "--password", "Strong-pass-1", "--business-id", str(app.ids["biz"]))
    assert r.exit_code == 0 and "Created MILKER" in r.output
    assert "milker2" in run(app, "list-users").output and "Strong-pass-1" not in run(app, "list-users").output
    c = app.test_client()
    assert c.post("/auth/login", json={"username": "milker2", "password": "Strong-pass-1"}).status_code == 200
    r = run(app, "reset-password", "--username", "milker2", "--password", "Another-pass-2")
    assert r.exit_code == 0
    assert app.test_client().post("/auth/login", json={"username": "milker2", "password": "Strong-pass-1"}).status_code == 401
    assert app.test_client().post("/auth/login", json={"username": "milker2", "password": "Another-pass-2"}).status_code == 200
    with app.app_context():
        assert "Another-pass-2" not in User.query.filter_by(username="milker2").first().password_hash


def test_create_user_rejects_bad_input(app):
    base = ["create-user", "--full-name", "X", "--role", "OWNER", "--business-id", str(app.ids["biz"])]
    assert run(app, *base, "--username", "owner1", "--password", "Strong-pass-1").exit_code != 0   # taken
    assert run(app, *base, "--username", "newbie", "--password", "short").exit_code != 0            # too short
    assert run(app, "create-user", "--username", "zzz1", "--full-name", "X", "--role", "OWNER",
               "--password", "Strong-pass-1").exit_code != 0                                         # ambiguous business
