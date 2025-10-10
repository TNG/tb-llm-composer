# Mock LLM responses

Real-world mock request-response pairs of interactions with the LLM.

The format is inspired by [mock-server](https://www.mock-server.com/mock_server/creating_expectations.html), however,
the request matching should mostly be done based on the request body since the path is configurable for example.
This enables easy copy-pasting examples from wherever you get your examples from.

A very basic example of a json in this folder looks like this:
```json
{
    "httpRequest": {
        "method": "POST",
        "path": "/login",
        "body": {
            "username": "foo",
            "password": "bar"
        }
    },
    "httpResponse": {
        "statusCode": 302,
        "headers": {
            "Location": [
                "https://www.mock-server.com"
            ]
        },
        "cookies": {
            "sessionId": "2By8LOhBmaW5nZXJwcmludCIlMDAzMW"
        }
    }
}
```
