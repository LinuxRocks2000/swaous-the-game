use protocol_v3::protocol::ProtocolFrame;
use protocol_v3::protocol_v3_macro::ProtocolFrame;
use protocol_v3::server::{ WebSocketServer, WebSocketClientStream };
use std::sync::Arc;


#[derive(ProtocolFrame)]
enum ClientToServer {
    SignUp (String, String) /* username, password */
}

#[derive(ProtocolFrame)]
enum ServerToClient {
    Welcome,
    SignUpFailed
}


async fn handle_client(mut client : WebSocketClientStream, connection : Arc<sqlite::ConnectionWithFullMutex>) {
    'cliloop: loop {
        let message : ClientToServer = match client.read().await {
            Some(message) => message,
            None => {break 'cliloop;}
        };
        match message {
            ClientToServer::SignUp(username, password) => {
                let mut is_clone = false;
                println!("Client is signing up");
                connection.iterate(format!("SELECT EXISTS(SELECT 1 FROM users WHERE name='{}')", username), |pairs| {
                    if pairs[0].1 == Some("1") {
                        println!("whoops");
                        is_clone = true;
                    }
                    true
                }).unwrap();
                if is_clone {
                    client.send(ServerToClient::SignUpFailed);
                }
                else {
                    connection.execute(format!("INSERT INTO users VALUES ({}, {}, {}, {})", username, password, )).unwrap();
                    client.send(ServerToClient::Welcome);
                }
            }
        }
    }
}


#[tokio::main]
async fn main() {
    let database = Arc::new(sqlite::Connection::open_with_full_mutex("swaous.db").unwrap());
    database.execute("CREATE TABLE IF NOT EXISTS users (name TEXT, password TEXT, last_activity INTEGER, id INTEGER); CREATE TABLE IF NOT EXISTS inventories (id INTEGER, card INTEGER);").unwrap();
    let mut server = WebSocketServer::new(8700, "Swaous".to_string()).await;
    loop {
        let cli = server.accept::<ClientToServer, ServerToClient>().await;
        tokio::task::spawn(handle_client(cli, database.clone()));
    }
}